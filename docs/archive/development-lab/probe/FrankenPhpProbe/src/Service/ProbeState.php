<?php declare(strict_types=1);

namespace Swag\FrankenPhpProbe\Service;

use Symfony\Contracts\Service\ResetInterface;

/**
 * Tagged with `kernel.reset`. If the kernel resets services between requests,
 * `$lastPath` is always null when a new request starts and `$resetCount` grows
 * by one per request. If it does not, `$lastPath` leaks the previous request's
 * path into the next one: exactly the cross-request state pollution the reset
 * is meant to prevent.
 */
final class ProbeState implements ResetInterface
{
    public int $resetCount = 0;

    public ?string $lastPath = null;

    public function reset(): void
    {
        ++$this->resetCount;
        $this->lastPath = null;
    }
}
