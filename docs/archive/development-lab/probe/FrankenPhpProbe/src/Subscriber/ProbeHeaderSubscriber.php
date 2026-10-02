<?php declare(strict_types=1);

namespace Swag\FrankenPhpProbe\Subscriber;

use Shopware\Core\Framework\Adapter\Twig\Runtime\CachedEscaperRuntime;
use Swag\FrankenPhpProbe\Service\ProbeState;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Adds X-Probe-* headers to every main response.
 *
 * Only use uncached responses for measurements (Admin API, Store API, or the
 * storefront with SHOPWARE_HTTP_CACHE_ENABLED=0): a response stored in the HTTP
 * cache keeps the headers of the request that produced it.
 */
final class ProbeHeaderSubscriber implements EventSubscriberInterface
{
    /**
     * Lives as long as the PHP process: 1 on every request under PHP-FPM
     * (one request per process lifecycle), growing in a FrankenPHP worker.
     */
    private static int $processRequests = 0;

    public function __construct(private readonly ProbeState $state)
    {
    }

    public static function getSubscribedEvents(): array
    {
        return [KernelEvents::RESPONSE => ['onResponse', -4096]];
    }

    public function onResponse(ResponseEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }

        ++self::$processRequests;

        $headers = $event->getResponse()->headers;
        $headers->set('X-Probe-Runtime', (string) ($_SERVER['APP_RUNTIME_MODE'] ?? \PHP_SAPI));
        $headers->set('X-Probe-Pid', (string) getmypid());
        $headers->set('X-Probe-Process-Requests', (string) self::$processRequests);
        $headers->set('X-Probe-Service-Resets', (string) $this->state->resetCount);
        $headers->set('X-Probe-Leaked-Path', $this->state->lastPath ?? '-');
        $headers->set('X-Probe-Memory', (string) memory_get_usage());
        $headers->set('X-Probe-Memory-Peak', (string) memory_get_peak_usage());
        $headers->set('X-Probe-Escape-Cache', (string) self::escapeCacheSize());

        $this->state->lastPath = $event->getRequest()->getPathInfo();
    }

    private static function escapeCacheSize(): int
    {
        if (!class_exists(CachedEscaperRuntime::class)) {
            return -1;
        }

        return (static fn (): int => \count(CachedEscaperRuntime::$escapeCache))
            ->bindTo(null, CachedEscaperRuntime::class)();
    }
}
