@inject('url', 'Flarum\Http\UrlGenerator')

@php
  $primaryColor = $settings->get('theme_primary_color');
  $secondaryColor = $settings->get('theme_secondary_color');
@endphp

<!DOCTYPE html>
<html lang="{{ $translator->getLocale() }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <title>{{ $title ?? $settings->get('forum_title') }}</title>
    <style>
        /* 邓州六高中校园墙 · 黑金琉璃主题邮件 */
        body {
            margin: 0;
            padding: 0;
            background-color: #0b0b0b;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
            font-size: 15px;
            line-height: 1.7;
            color: #e8e3d8;
            -webkit-font-smoothing: antialiased;
        }
        .wrapper {
            width: 100%;
            padding: 32px 16px;
            box-sizing: border-box;
            background: radial-gradient(1200px 500px at 50% -10%, rgba(201, 169, 110, 0.14), transparent 60%),
                        radial-gradient(900px 400px at 85% 0%, rgba(201, 169, 110, 0.08), transparent 55%),
                        #0b0b0b;
        }
        .card {
            max-width: 580px;
            margin: 0 auto;
            border-radius: 16px;
            overflow: hidden;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(201, 169, 110, 0.28);
            box-shadow: 0 12px 48px rgba(0, 0, 0, 0.55);
        }
        .brand {
            padding: 28px 36px 22px;
            text-align: center;
            background: linear-gradient(180deg, rgba(201, 169, 110, 0.10), rgba(201, 169, 110, 0.02));
            border-bottom: 1px solid rgba(201, 169, 110, 0.18);
        }
        .brand-logo {
            display: inline-block;
            font-size: 15px;
            letter-spacing: 3px;
            font-weight: 600;
            color: #c9a96e;
            text-decoration: none;
            margin-bottom: 6px;
        }
        .brand-sub {
            font-size: 12px;
            letter-spacing: 1px;
            color: rgba(232, 227, 216, 0.55);
        }
        .body {
            padding: 32px 36px 36px;
        }
        .greeting {
            margin: 0 0 20px;
            font-size: 15px;
            color: #e8e3d8;
        }
        .greeting strong {
            color: #c9a96e;
            font-weight: 600;
        }
        .title {
            margin: 0 0 18px;
            font-size: 20px;
            font-weight: 600;
            color: #f5f1e8;
            line-height: 1.4;
        }
        .main-content {
            font-size: 15px;
            color: #d8d2c6;
            line-height: 1.8;
            white-space: pre-line;
        }
        .main-content a {
            color: #c9a96e;
            text-decoration: none;
            border-bottom: 1px solid rgba(201, 169, 110, 0.4);
        }
        .button {
            display: inline-block;
            margin: 22px 0 8px;
            padding: 14px 34px;
            font-size: 15px;
            font-weight: 600;
            letter-spacing: 1px;
            color: #1a1408;
            text-decoration: none;
            border-radius: 999px;
            background: linear-gradient(135deg, #d9bb7e 0%, #c9a96e 50%, #b8945c 100%);
            box-shadow: 0 4px 18px rgba(201, 169, 110, 0.35);
        }
        .content-preview {
            margin: 18px 0;
            padding: 16px 18px;
            border-radius: 10px;
            background: rgba(201, 169, 110, 0.06);
            border: 1px solid rgba(201, 169, 110, 0.18);
            font-size: 14px;
            color: #c9c2b2;
        }
        .divider {
            height: 1px;
            margin: 26px 0;
            background: rgba(201, 169, 110, 0.16);
        }
        .signoff {
            margin: 0;
            font-size: 14px;
            color: #b8b0a0;
            font-style: italic;
        }
        .footer {
            padding: 20px 36px 26px;
            text-align: center;
            font-size: 12px;
            color: rgba(232, 227, 216, 0.45);
            border-top: 1px solid rgba(201, 169, 110, 0.14);
            line-height: 1.8;
        }
        .footer a {
            color: #c9a96e;
            text-decoration: none;
        }
        @media only screen and (max-width: 600px) {
            .wrapper { padding: 16px 10px; }
            .brand { padding: 22px 20px 18px; }
            .body { padding: 24px 22px 28px; }
            .footer { padding: 16px 22px 22px; }
        }
    </style>
</head>
<body>
<div class="wrapper">
    <div class="card">
        <div class="brand">
            <a href="{{ $url->to('forum')->base() }}" class="brand-logo">
                @if ($logoUrl)
                    <img src="{{ $logoUrl }}" alt="{{ $settings->get('forum_title') }}" style="max-height:44px; vertical-align:middle;">
                @else
                    {{ $settings->get('forum_title') }}
                @endif
            </a>
            <div class="brand-sub">DENGZHOU NO.6 SENIOR HIGH · 校园墙</div>
        </div>

        <div class="body">
            @if(!isset($greeting) || $greeting !== false)
                <p class="greeting">{!! $translator->trans('core.email.greeting', ['displayName' => $username]) !!}</p>
            @endif

            <div class="main-content">
                {!! $header ?? '' !!}
                {!! $content ?? '' !!}
            </div>

            @if(!isset($signoff) || $signoff !== false)
                <div class="divider"></div>
                <p class="signoff">{!! $translator->trans('core.email.signoff', ['forumTitle' => $settings->get('forum_title')]) !!}</p>
            @endif
        </div>

        <div class="footer">
            {{ $footer ?? '' }}
        </div>
    </div>
</div>
</body>
</html>
