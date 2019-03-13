# ITMP

[![NPM](https://nodei.co/npm-dl/itmp.png)](https://nodei.co/npm/itmp/) [![NPM](https://nodei.co/npm/itmp.png)](https://nodei.co/npm/itmp/)

itmp.js is a client and server library for the [ITMP](http://itmp.org/) protocol, written in JavaScript for node.js and the browser.

* [Installation](#install)
* [Example](#example)
* [API](#api)
* [Browser](#browser)
* [Weapp](#weapp)
* [About QoS](#qos)
* [TypeScript](#typescript)
* [Contributing](#contributing)
* [License](#license)

itmp.js is an OPEN Open Source Project, see the [Contributing](#contributing) section to find out what this means.

[![JavaScript Style
Guide](https://cdn.rawgit.com/feross/standard/master/badge.svg)](https://github.com/feross/standard)

<a name="install"></a>

## Installation

```sh
npm install itmp --save
```

<a name="example"></a>
## Example

For the sake of simplicity, let's put the subscriber and the publisher in the same file:

```js
var itmp = require('itmp')
var client  = itmp.connect('ws://test.itmp.org')

client.on('connect', function () {
  client.subscribe('presence').then(function (err) {
    client.publish('presence', 'Hello itmp')
  })
})

client.on(client.$message, function (topic, message) {
  // message is object
  console.log(message)
})
```

output:
```
Hello itmp
```

If you want to run your own itmp server, you can use
[Itmp.online](http://itmp.online), and launch it.
You can also use a test instance: test.itmp.online is both public.

If you do not want to install a separate server, you can try using the
[itmp-connection](https://www.npmjs.com/package/itmp-connection).

to use itmp.js in the browser see the [browserify](#browserify) section

<a name="promises"></a>
## Promise support

If you want to use the new [async-await](https://blog.risingstack.com/async-await-node-js-7-nightly/) functionality in JavaScript just use itmp.js which uses promises instead of callbacks when possible.

<a name="cli"></a>
## Command Line Tools

itmp.js bundles a command to interact with a server.
In order to have it available on your path, you should install itmp.js
globally:

```sh
npm install itmp -g
```

Then, on one terminal

```
itmp sub -t 'hello' -h 'test.mosquitto.org' -v
```

On another

```
itmp pub -t 'hello' -h 'test.mosquitto.org' -m 'from itmp.js'
```

See `itmp help <command>` for the command help.

<a name="api"></a>
## API

  * <a href="#connect"><code>itmp.<b>connect()</b></code></a>
  * <a href="#client"><code>itmp.<b>Client()</b></code></a>
  * <a href="#publish"><code>itmp.Client#<b>publish()</b></code></a>
  * <a href="#subscribe"><code>itmp.Client#<b>subscribe()</b></code></a>
  * <a href="#unsubscribe"><code>itmp.Client#<b>unsubscribe()</b></code></a>
  * <a href="#end"><code>itmp.Client#<b>end()</b></code></a>
  * <a href="#removeOutgoingMessage"><code>itmp.Client#<b>removeOutgoingMessage()</b></code></a>
  * <a href="#reconnect"><code>itmp.Client#<b>reconnect()</b></code></a>
  * <a href="#handleMessage"><code>itmp.Client#<b>handleMessage()</b></code></a>
  * <a href="#connected"><code>itmp.Client#<b>connected</b></code></a>
  * <a href="#reconnecting"><code>itmp.Client#<b>reconnecting</b></code></a>
  * <a href="#getLastMessageId"><code>itmp.Client#<b>getLastMessageId()</b></code></a>
  * <a href="#store"><code>itmp.<b>Store()</b></code></a>
  * <a href="#put"><code>itmp.Store#<b>put()</b></code></a>
  * <a href="#del"><code>itmp.Store#<b>del()</b></code></a>
  * <a href="#createStream"><code>itmp.Store#<b>createStream()</b></code></a>
  * <a href="#close"><code>itmp.Store#<b>close()</b></code></a>

-------------------------------------------------------
<a name="connect"></a>
### itmp.connect([url], options)

Connects to the server specified by the given url and options and
returns a [Client](#client).

The URL can be on the following protocols: 'udp', 'serial', 'ws', 'wss'. The URL can also be an object as returned by
[`URL.parse()`](http://nodejs.org/api/url.html#url_url_parse_urlstr_parsequerystring_slashesdenotehost),
in that case the two objects are merged, i.e. you can pass a single
object with both the URL and the connect options.

You can also specify a `servers` options with content: `[{ host:
'localhost', port: 1883 }, ... ]`, in that case that array is iterated
at every connect.

For all itmp-related options, see the [Client](#client)
constructor.

-------------------------------------------------------
<a name="client"></a>
### itmp.Client(streamBuilder, options)

The `Client` class wraps a client connection to an
itmp server over an arbitrary transport method (TCP, TLS,
WebSocket, ecc).

`Client` automatically handles the following:

* Regular server pings
* QoS flow
* Automatic reconnections
* Start publishing before being connected

The arguments are:

* `streamBuilder` is a function that returns a subclass of the `Stream` class that supports
the `connect` event. Typically a `net.Socket`.
* `options` is the client connection options (see: the [connect packet](https://github.com/mcollina/itmp-packet#connect)). Defaults:
  * `keepalive`: `60` seconds, set to `0` to disable
  * `reschedulePings`: reschedule ping messages after sending packets (default `true`)
  * `clientId`: `'itmpjs_' + Math.random().toString(16).substr(2, 8)`
  * `clean`: `true`, set to false to receive QoS 1 and 2 messages while
    offline
  * `reconnectPeriod`: `1000` milliseconds, interval between two
    reconnections
  * `connectTimeout`: `30 * 1000` milliseconds, time to wait before a
    CONNACK is received
  * `username`: the username required by your server, if any
  * `password`: the password required by your server, if any
  * `incomingStore`: a [Store](#store) for the incoming packets
  * `outgoingStore`: a [Store](#store) for the outgoing packets
  * `queueEvents`: if connection is broken, queue outgoing QoS zero messages (default `true`)
  * `will`: a message that will sent by the server automatically when
     the client disconnect badly. The format is:
    * `topic`: the topic to publish
    * `payload`: the message to publish
    * `properties`: properties of will
  * `resubscribe` : if connection is broken and reconnects,
     subscribed topics are automatically subscribed again (default `true`)

In case itmps (itmp over tls) is required, the `options` object is
passed through to
[`tls.connect()`](http://nodejs.org/api/tls.html#tls_tls_connect_options_callback).
If you are using a **self-signed certificate**, pass the `rejectUnauthorized: false` option.
Beware that you are exposing yourself to man in the middle attacks, so it is a configuration
that is not recommended for production environments.

#### Event `Client.$connect`

`function (linkname) {}`

Emitted on successful (re)connection.

#### Event `Client.$disconnect`

`function () {}`

Emitted after a disconnection.

#### Event `Client.$message`

`function (link, address, topic, message, options) {}`

Emitted when the client receives a publish packet

* `link` link object of the received packet
* `address` address of the sender of the received packet
* `topic` topic of the received packet
* `message` payload of the received packet
* `options` options of the received packet

-------------------------------------------------------
<a name="publish"></a>
### itmp.Client#publish(topic, message, [options])

Publish a message to a topic

* `topic` is the topic to publish to, `String`
* `message` is the message to publish, any js type except array and object will be surrounded by array
* `options` is the options to publish with, including:

-------------------------------------------------------
<a name="subscribe"></a>
### itmp.Client#subscribe(topic/topic array, [options], callback)

Subscribe to a topic or topics

* `topic` is a `String` topic to subscribe to or an `Array` of
  topics to subscribe to.
  itmp `topic` wildcard characters are supported (`+` - for single level and `#` - for multi level)
* `options` is the options to subscribe with, including:
* `callback` - `function (topic)`, fired on get message.

-------------------------------------------------------
<a name="unsubscribe"></a>
### itmp.Client#unsubscribe(topic/topic array, [callback])

Unsubscribe from a topic or topics

* `topic` is a `String` topic or an array of topics to unsubscribe from
* `callback` - `function`, unsubscribe this handler.

-------------------------------------------------------
<a name="end"></a>
### itmp.Client#end([force], [options])

Close the client, accepts the following options:

* `force`: passing it to true will close the client right away, without
  waiting for the in-flight messages to be acked. This parameter is
  optional.
* `options`: options of disconnect.
  * `reasonCode`: Disconnect Reason Code `number`

-------------------------------------------------------
<a name="reconnect"></a>
### itmp.Client#reconnect()

Connect again using the same options as connect()

-------------------------------------------------------
<a name="connected"></a>
### itmp.Client#connected

Boolean : set to `true` if the client is connected. `false` otherwise.

-------------------------------------------------------
<a name="reconnecting"></a>
### itmp.Client#reconnecting

Boolean : set to `true` if the client is trying to reconnect to the server. `false` otherwise.

-------------------------------------------------------
<a name="store"></a>
### itmp.Store(options)

In-memory implementation of the message store.

* `options` is the store options:
  * `clean`: `true`, clean inflight messages when close is called (default `true`)

Other implementations of `itmp.Store`:

* [itmp-level-store](http://npm.im/itmp-level-store) which uses
  [Level-browserify](http://npm.im/level-browserify) to store the inflight
  data, making it usable both in Node and the Browser.

-------------------------------------------------------
<a name="put"></a>
### itmp.Store#put(packet)

Adds a packet to the store, a packet is
anything that has a `messageId` property.
The callback is called when the packet has been stored.

-------------------------------------------------------
<a name="del"></a>
### itmp.Store#del(packet, cb)

Removes a packet from the store, a packet is
anything that has a `messageId` property.
The callback is called when the packet has been removed.

-------------------------------------------------------
<a name="close"></a>
### itmp.Store#close(cb)

Closes the Store.

<a name="browser"></a>
## Browser

<a name="cdn"></a>
### Via CDN

The itmp.js bundle is available through http://unpkg.com, specifically
at https://unpkg.com/itmp/dist/itmp.min.js.
See http://unpkg.com for the full documentation on version ranges.

<a name="example"></a>

## Example(js)

```js
var itmp = require('itmp')
var client = itmp.connect('wxs://test.itmp.online')
```

## Example(ts)

```ts
import { connect } from 'itmp';
const client = connect('wxs://test.itmp.online');
```

<a name="browserify"></a>
### Browserify

In order to use itmp.js as a browserify module you can either require it in your browserify bundles or build it as a stand alone module. The exported module is AMD/CommonJs compatible and it will add an object in the global space.

```javascript
npm install -g browserify // install browserify
cd node_modules/itmp
npm install . // install dev dependencies
browserify itmp.js -s itmp > browseritmp.js // require itmp in your client-side app
```

<a name="webpack"></a>
### Webpack

Just like browserify, export itmp.js as library. The exported module would be `var itmp = xxx` and it will add an object in the global space. You could also export module in other [formats (AMD/CommonJS/others)](http://webpack.github.io/docs/configuration.html#output-librarytarget) by setting **output.libraryTarget** in webpack configuration.

```javascript
npm install -g webpack // install webpack

cd node_modules/itmp
npm install . // install dev dependencies
webpack itmp.js ./browseritmp.js --output-library itmp
```

you can then use itmp.js in the browser with the same api than node's one.

```html
<html>
<head>
  <title>test Ws itmp.js</title>
</head>
<body>
<script src="./browseritmp.js"></script>
<script>
  var client = itmp.connect() // you add a ws:// url here
  client.subscribe("itmp/demo")

  client.on(client.$message, function (topic, payload) {
    alert([topic, payload].join(": "))
    client.end()
  })

  client.publish("itmp/demo", "hello world!")
</script>
</body>
</html>
```

Your server should accept websocket connection (see [itmp over Websockets](https://github.com/neolp/itmp/wiki/itmp-over-Websockets) to setup).

<a name="qos"></a>
## About QoS

Here is how QoS works:

* QoS 0 : received **at most once** : The packet is sent, and that's it. There is no validation about whether it has been received.
* QoS 1 : received **at least once** : The packet is sent and stored as long as the client has not received a confirmation from the server. itmp ensures that it *will* be received, but there can be duplicates.
* QoS 2 : received **exactly once** : Same as QoS 1 but there is no duplicates.

About data consumption, obviously, QoS 2 > QoS 1 > QoS 0, if that's a concern to you.

<a name="typescript"></a>
## Usage with TypeScript
This repo bundles TypeScript definition files for use in TypeScript projects and to support tools that can read `.d.ts` files.

### Pre-requisites
Before you can begin using these TypeScript definitions with your project, you need to make sure your project meets a few of these requirements:
 * TypeScript >= 2.1
 * Set tsconfig.json: `{"compilerOptions" : {"moduleResolution" : "node"}, ...}`
 * Includes the TypeScript definitions for node. You can use npm to install this by typing the following into a terminal window:
   `npm install --save-dev @types/node`

<a name="contributing"></a>
## Contributing

itmp.js is an **OPEN Open Source Project**. This means that:

> Individuals making significant and valuable contributions are given commit-access to the project to contribute as they see fit. This project is more like an open wiki than a standard guarded open source project.

See the [CONTRIBUTING.md](CONTRIBUTING.md) file for more details.

<a name="license"></a>
## License

MIT
