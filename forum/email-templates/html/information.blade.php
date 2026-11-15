<x-mail::html :greeting="$greeting ?? null" :signoff="$signoff ?? null">
    <x-slot:header>
        <h2>{{ $title ?? $translator->trans('core.email.informational.default_title') }}</h2>
    </x-slot:header>

    <x-slot:content>
        @php
            // dz6g 定制：把正文里那串裸的重置链接换成金色胶囊按钮
            // 正文此时是纯文本（换行符 + 裸 URL），不是 HTML，所以按纯文本匹配
            $dz6gBody = (string) ($body ?? $slot ?? '');
            if (preg_match('~https?://\S*?/reset/\S+~', $dz6gBody, $dz6gM)) {
                $dz6gBtn = '<a class="button" target="_blank" href="'.$dz6gM[0].'"'
                    .' style="display:inline-block;margin:14px 0 6px;padding:14px 34px;'
                    .'font-size:15px;font-weight:600;letter-spacing:1px;color:#1a1408;'
                    .'text-decoration:none;border:0 none;border-radius:999px;line-height:1.2;'
                    .'background:linear-gradient(135deg,#d9bb7e 0%,#c9a96e 50%,#b8945c 100%);'
                    .'box-shadow:0 4px 18px rgba(201,169,110,0.35)">重设密码</a>';
                $dz6gBody = str_replace($dz6gM[0], '<br>'.$dz6gBtn, $dz6gBody);
            }
        @endphp
        {!! $dz6gBody !!}
        @if (isset($preview))
            <div class="content-preview">
                {!! $preview !!}
            </div>
        @endif
    </x-slot:content>

    <x-slot:footer>
        <p>{!! $formatter->convert($translator->trans('core.email.informational.footer', ['userEmail' => $userEmail, 'forumUrl' => $url->to('forum')->base(), 'forumTitle' => $settings->get('forum_title')])) !!}</p>
    </x-slot:footer>
</x-mail::html>
