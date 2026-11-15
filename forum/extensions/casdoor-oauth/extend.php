<?php

use DZ6G\CasdoorOAuth\CasdoorProvider;
use FoF\OAuth\Extend\RegisterProvider;
use Flarum\Extend;

return [
    (new RegisterProvider(CasdoorProvider::class)),
    (new Extend\Locales(__DIR__ . '/resources/locale')),
];
