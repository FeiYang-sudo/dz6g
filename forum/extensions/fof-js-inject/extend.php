<?php

use Flarum\Extend;
use Flarum\User\Event\Saving;
use Flarum\User\User;
use Illuminate\Support\Arr;

return [
    (new Extend\Frontend('forum'))
        ->js(__DIR__.'/assets/forum.js'),
    (new Extend\Frontend('admin'))
        ->js(__DIR__.'/assets/admin.js'),

    // 注册时把请求里的 birthday 存进用户 preferences
    (new Extend\EventListener())
        ->listen(Saving::class, function (Saving $event) {
            $body = $event->data['data'] ?? [];
            $attributes = Arr::get($body, 'attributes', []);

            if (!isset($attributes['birthday'])) {
                return;
            }

            $birthday = trim((string) $attributes['birthday']);
            if ($birthday === '') {
                return;
            }

            // 校验格式 YYYY-MM-DD
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $birthday)) {
                return;
            }

            $event->user->setPreference('birthday', $birthday);
        }),
];
