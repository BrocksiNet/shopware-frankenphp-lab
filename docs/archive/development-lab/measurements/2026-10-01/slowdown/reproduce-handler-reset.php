<?php declare(strict_types=1);

use Monolog\Handler\FingersCrossedHandler;
use Monolog\Handler\NullHandler;
use Monolog\Level;
use Monolog\Logger;
use Shopware\Core\Framework\Log\Monolog\ErrorCodeLogLevelHandler;
use Shopware\Core\Framework\Log\Monolog\ExcludeExceptionHandler;
use Shopware\Core\Framework\Log\Monolog\ExcludeFlowEventHandler;

require '/var/www/html/vendor/autoload.php';

// Optional control: load saved unmodified Shopware classes instead of mounted corrections.
if (in_array('--original', $argv, true)) {
    foreach (['ExcludeExceptionHandler', 'ErrorCodeLogLevelHandler', 'ExcludeFlowEventHandler'] as $class) {
        require __DIR__ . '/original-' . $class . '.php';
    }
}

$failures = 0;
foreach (['exception', 'level', 'flow', 'chain'] as $scenario) {
    $buffer = new class(new NullHandler(), Level::Error) extends FingersCrossedHandler {
        public function retainedCount(): int
        {
            return count($this->buffer);
        }
    };
    $handler = match ($scenario) {
        'exception' => new ExcludeExceptionHandler($buffer, []),
        'level' => new ErrorCodeLogLevelHandler($buffer, []),
        'flow' => new ExcludeFlowEventHandler($buffer, []),
        'chain' => new ExcludeFlowEventHandler(
            new ErrorCodeLogLevelHandler(new ExcludeExceptionHandler($buffer, []), []),
            [],
        ),
    };
    $logger = new Logger('request', [$handler]);
    for ($request = 0; $request < 1000; ++$request) {
        $logger->info('Simulated successful request');
        $handler->reset();
    }
    $retained = $buffer->retainedCount();
    printf("%s: retained=%d, expected=0 %s\n", $scenario, $retained, $retained === 0 ? 'PASS' : 'FAIL');
    if ($retained !== 0) {
        ++$failures;
    }
}
exit($failures === 0 ? 0 : 1);
