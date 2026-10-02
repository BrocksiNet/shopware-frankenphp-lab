<?php declare(strict_types=1);

namespace Symfony\Component\DependencyInjection\Loader\Configurator;

use Swag\FrankenPhpProbe\Service\ProbeState;
use Swag\FrankenPhpProbe\Subscriber\ProbeHeaderSubscriber;

return static function (ContainerConfigurator $container): void {
    $services = $container->services();

    $services->set(ProbeState::class)
        ->tag('kernel.reset', ['method' => 'reset']);

    $services->set(ProbeHeaderSubscriber::class)
        ->args([service(ProbeState::class)])
        ->tag('kernel.event_subscriber');
};
