<?php

namespace DZ6G\CasdoorOAuth;

use Flarum\Forum\Auth\Registration;
use FoF\OAuth\Provider;
use Illuminate\Support\Arr;
use League\OAuth2\Client\Provider\GenericProvider;

class CasdoorProvider extends Provider
{
    public function name(): string
    {
        return 'casdoor';
    }

    public function link(): string
    {
        return 'https://casdoor.ai';
    }

    public function icon(): string
    {
        return 'fas fa-id-card';
    }

    public function fields(): array
    {
        return [
            'client_id'      => 'required',
            'client_secret'  => 'required',
            'base_url'       => 'required',
        ];
    }

    public function provider(string $redirectUri): ?\League\OAuth2\Client\Provider\AbstractProvider
    {
        // Use public URL for browser redirect (authorize), localhost for backend API calls
        // This avoids Cloudflare loopback latency when exchanging tokens and fetching userinfo
        $baseUrl = rtrim($this->getSetting('base_url'), '/');
        $internalUrl = 'http://127.0.0.1:8000';

        return new GenericProvider([
            'clientId'                => $this->getSetting('client_id'),
            'clientSecret'            => $this->getSetting('client_secret'),
            'redirectUri'             => $redirectUri,
            'urlAuthorize'            => $baseUrl . '/login/oauth/authorize',
            // Use localhost for backend-to-backend API calls to avoid Cloudflare loopback latency
            'urlAccessToken'          => $internalUrl . '/api/login/oauth/access_token',
            'urlResourceOwnerDetails' => $internalUrl . '/api/userinfo',
            'scopes'                  => ['openid', 'profile', 'email'],
            'responseResourceOwnerId' => 'sub',
        ]);
    }

    public function pkceEnabled(): bool
    {
        return true;
    }

    public function options(): array
    {
        return ['scope' => ['openid', 'profile', 'email']];
    }

    public function suggestions(Registration $registration, mixed $user, string $token): void
    {
        $data = $user->toArray();

        $sub = Arr::get($data, 'sub', '');
        $name = Arr::get($data, 'name', '');
        $displayName = Arr::get($data, 'displayName', '');
        $preferredUsername = Arr::get($data, 'preferred_username', '');
        $email = Arr::get($data, 'email', '');

        $username = $preferredUsername ?: ($displayName ?: ($name ?: 'casdoor_user_' . substr(str_replace('/', '_', $sub), -12)));

        $registration
            ->suggestUsername($username)
            ->setPayload($data);

        if ($email) {
            $registration->suggestEmail($email);
        }

        $avatar = Arr::get($data, 'avatar', '');
        if ($avatar) {
            $this->provideAvatar($registration, $avatar);
        }
    }
}
