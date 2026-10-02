<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

declare(strict_types=1);

namespace Symfony\Component\Runtime\Runner;

use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Component\HttpKernel\TerminableInterface;
use Symfony\Component\Runtime\RunnerInterface;

/**
 * A runner for FrankenPHP in worker mode.
 *
 * @author Kévin Dunglas <kevin@dunglas.dev>
 */
class FrankenPhpWorkerRunner implements RunnerInterface
{
    public function __construct(
        private HttpKernelInterface $kernel,
        private int $loopMax,
    ) {
    }

    public function run(): int
    {
        // Prevent worker script termination when a client connection is interrupted
        ignore_user_abort(true);

        $server = array_filter($_SERVER, static fn (string $key) => !str_starts_with($key, 'HTTP_'), \ARRAY_FILTER_USE_KEY);
        $server['APP_RUNTIME_MODE'] = 'web=1&worker=1';

        $handledMs = 0.0;
        $handler = function () use ($server, &$sfRequest, &$sfResponse, &$handledMs): void {
            $handleStart = hrtime(true);
            // Connect to the Xdebug client if it's available
            if (\extension_loaded('xdebug') && \function_exists('xdebug_connect_to_client')) {
                xdebug_connect_to_client();
            }

            // Merge the environment variables coming from DotEnv with the ones tied to the current request
            $_SERVER += $server;

            $sfRequest = Request::createFromGlobals();
            $sfResponse = $this->kernel->handle($sfRequest);

            $sfResponse->send();
            $handledMs = (hrtime(true) - $handleStart) / 1e6;
        };

        $loops = 0;
        $requests = 0;
        $sums = ["handleMs" => 0.0, "terminateMs" => 0.0, "gcMs" => 0.0];
        do {
            $ret = frankenphp_handle_request($handler);

            $terminateStart = hrtime(true);
            if ($this->kernel instanceof TerminableInterface && $sfRequest && $sfResponse) {
                $this->kernel->terminate($sfRequest, $sfResponse);
            }

            $terminateMs = (hrtime(true) - $terminateStart) / 1e6;
            ++$requests;
            $gcStart = hrtime(true);
            gc_collect_cycles();
            $gcMs = (hrtime(true) - $gcStart) / 1e6;
            $sums['handleMs'] += $handledMs;
            $sums['terminateMs'] += $terminateMs;
            $sums['gcMs'] += $gcMs;
            if ($requests % 100 === 0) {
                file_put_contents('/tmp/diag-metrics.jsonl', json_encode([
                    'requests' => $requests,
                    'phaseSums100' => $sums,
                    'phpUsedBytes' => memory_get_usage(false),
                    'phpAllocatedBytes' => memory_get_usage(true),
                    'gc' => gc_status(),
                ])."\n", FILE_APPEND);
                $sums = ['handleMs' => 0.0, 'terminateMs' => 0.0, 'gcMs' => 0.0];
            }
        } while ($ret && (0 >= $this->loopMax || ++$loops < $this->loopMax));

        return 0;
    }
}
