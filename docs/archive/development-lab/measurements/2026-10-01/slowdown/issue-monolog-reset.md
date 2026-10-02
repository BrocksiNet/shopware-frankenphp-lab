### Shopware Version

Development commit `868f25121f764f41d6490fd032d6f28507be4e43`, Monolog 3.12.1.

### Affected area / extension

Platform(Default), core logging.

### Actual behaviour

In a persistent PHP worker, the same application handles multiple requests. Shopware's production logger buffers log records until an error occurs. This buffer should be cleared when services are reset between requests.

Three core logging decorators prevent that cleanup. They inherit an empty `reset()` method instead of forwarding the call to the wrapped handler:

- [ExcludeFlowEventHandler](https://github.com/shopware/shopware/blob/868f25121f764f41d6490fd032d6f28507be4e43/src/Core/Framework/Log/Monolog/ExcludeFlowEventHandler.php)
- [ErrorCodeLogLevelHandler](https://github.com/shopware/shopware/blob/868f25121f764f41d6490fd032d6f28507be4e43/src/Core/Framework/Log/Monolog/ErrorCodeLogLevelHandler.php)
- [ExcludeExceptionHandler](https://github.com/shopware/shopware/blob/868f25121f764f41d6490fd032d6f28507be4e43/src/Core/Framework/Log/Monolog/ExcludeExceptionHandler.php)

They [wrap the production `monolog.handler.main` service](https://github.com/shopware/shopware/blob/868f25121f764f41d6490fd032d6f28507be4e43/src/Core/Framework/DependencyInjection/services.php#L860). Even when Symfony resets services correctly, the inner Monolog buffer retains records from previous requests. This increases memory use and garbage-collection work as the worker continues serving traffic.

### Expected behaviour

All three decorators should forward `reset()` to their inner handler when it implements `Monolog\ResettableInterface`. Add regression coverage for each decorator and the full chain, including non-resettable inner handlers.

### How to reproduce

Run the script below from a Shopware checkout with Composer dependencies installed. No database or FrankenPHP is required. It logs 1,000 info records, calling reset after each one.

**Actual:** each decorator and the full chain retain 1,000 records. **Expected:** zero.

<details>
<summary>Standalone reproduction</summary>

```php
<?php declare(strict_types=1);

use Monolog\Handler\FingersCrossedHandler;
use Monolog\Handler\NullHandler;
use Monolog\Level;
use Monolog\Logger;
use Shopware\Core\Framework\Log\Monolog\ErrorCodeLogLevelHandler;
use Shopware\Core\Framework\Log\Monolog\ExcludeExceptionHandler;
use Shopware\Core\Framework\Log\Monolog\ExcludeFlowEventHandler;

require getcwd() . '/vendor/autoload.php';

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
```

</details>

### Verification

Forwarding reset in all three decorators makes all four reproduction cases pass. In a separate FrankenPHP test, the corrected worker served over 17,900 requests with recycling disabled, without the previous progressive log-buffer growth and slowdown. This validates the proposed correction for this defect; it does not establish general worker compatibility.
