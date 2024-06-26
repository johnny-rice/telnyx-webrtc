# @telnyx/react-client

> React wrapper for Telnyx Client

[![NPM](https://img.shields.io/npm/v/@telnyx/react-client.svg)](https://www.npmjs.com/package/@telnyx/react-client) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## Install

```bash
npm install --save @telnyx/react-client @telnyx/webrtc
```

## Usage example

```jsx
// App.jsx
import { TelnyxRTCProvider } from '@telnyx/react-client';

function App() {
  const credential = {
    login_token: 'mytoken',
  };

  return (
    <TelnyxRTCProvider credential={credential}>
      <Phone />
    </TelnyxRTCProvider>
  );
}
```

```jsx
// Phone.jsx
import { useNotification, Audio } from '@telnyx/react-client';

function Phone() {
  const notification = useNotification();
  const activeCall = notification && notification.call;

  return (
    <div>
      {activeCall &&
        activeCall.state === 'ringing' &&
        'You have an incoming call.'}

      <Audio stream={activeCall && activeCall.remoteStream} />
    </div>
  );
}
```

## Hooks

### `useCallbacks`

```jsx
import { useCallbacks } from '@telnyx/react-client';

function Phone() {
  useCallbacks({
    onReady: () => console.log('client ready'),
    onError: () => console.log('client registration error'),
    onSocketError: () => console.log('client socket error'),
    onSocketClose: () => console.log('client disconnected'),
    onNotification: (x) => console.log('received notification:', x),
  });

  // ...
}
```

### `useTelnyxRTC`

If you need more fine-tuned control over TelnyxRTC, you also have access to `useTelnyxRTC` directly.

```jsx
import { useTelnyxRTC } from '@telnyx/react-client';

function Phone() {
  const client = useTelnyxRTC({ login_token: 'mytoken' });

  client.on('telnyx.ready', () => {
    console.log('client ready');
  });

  // ...
}
```

Take care to use this hook only once in your application. For most cases, we recommend you use [TelnyxRTCContext/TelnyxRTCProvider](#TelnyxRTCContextProvider) instead of this hook directly. This ensures that you only have one Telnyx client instance running at a time.

### `useContext` with `TelnyxRTCContext`

You can retrieve the current TelnyxRTC context value by using React's [`useContext` hook](https://reactjs.org/docs/hooks-reference.html#usecontext), as an alternative to [TelnyxRTCContext.Consumer](#TelnyxRTCContextConsumer).

```jsx
import React, { useContext } from 'react';
import { TelnyxRTCContext } from '@telnyx/react-client';

function Phone() {
  const client = useContext(TelnyxRTCContext);

  client.on('telnyx.ready', () => {
    console.log('client ready');
  });

  // ...
}
```

## Components

### `TelnyxRTCContextProvider`

```jsx
import { TelnyxRTCProvider } from '@telnyx/react-client';

function App() {
  const credential = {
    // You can either use your On-Demand Credential token
    // or your Telnyx SIP username and password
    // login_token: 'mytoken',
    login: 'myusername',
    password: 'mypassword',
  };

  const options = {
    ringtoneFile: 'https://example.com/sounds/incoming_call.mp3',
    ringbackFile: 'https://example.com/sounds/ringback_tone.mp3',
  };

  return (
    <TelnyxRTCProvider credential={credential} options={options}>
      <Phone />
    </TelnyxRTCProvider>
  );
}
```

### `TelnyxRTCContext.Consumer`

```jsx
import { TelnyxRTCContext } from '@telnyx/react-client';

function PhoneWrapper() {
  return (
    <TelnyxRTCContext.Consumer>
      {(context) => <Phone client={context} />}
    </TelnyxRTCContext.Consumer>
  );
}
```

### `Audio`

```jsx
import { Audio } from '@telnyx/react-client';

function Phone({ activeCall }) {
  return (
    <div>
      <Audio stream={activeCall.remoteStream} />
    </div>
  );
}
```

### `Video`

```jsx
import { Video } from '@telnyx/react-client';

function VideoConference({ activeCall }) {
  return (
    <div>
      <Video stream={activeCall.localStream} muted />
      <Video stream={activeCall.remoteStream} />
    </div>
  );
}
```

---

## Debugging

Enabling debugging will help telnyx diagnose issues on the client side
to enable debugging you can set `debug=true` in the provider options

```jsx
<TelnyxRTCProvider credential={credential} options={{ debug: true }}>
  // Your app goes here
</TelnyxRTCProvider>
```

## Development

Install dependencies:

```bash
yarn install
yarn start
yarn link

# in another tab:
git clone https://github.com/team-telnyx/webrtc-examples/tree/main/react-client/react-app

# fill in .env
yarn install
yarn link @telnyx/react-client
yarn start
```

---

## Contributing

See [Contribution Guide](../../docs/Contributing.md)

## License

[MIT](../../LICENSE) © [Telnyx](https://github.com/team-telnyx)
