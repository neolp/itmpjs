var itmp = require('./itmp4.js')

var server = new itmp().listen({
  //  mqtt: 'tcp://localhost:1883',
  //  mqtts: 'ssl://localhost:8883',
  mqttws: 'ws://localhost:1884/ws',
  //  mqtwss: 'wss://localhost:8884'
}, {/*
  ssl: {
    key: fs.readFileSync('./server.key'),
    cert: fs.readFileSync('./server.crt')
  },*/
  emitEvents: true // default
}, (client) => {
  client.connack({
    returnCode: 0
  })
}).connect({
  com: 'serial://COM3?baudRate=115200&dataBits=8&stopBits=1&parity=none'
  //  com:'serial:///dev/ttyS0?baudRate=115200&dataBits=8&stopBits=1&parity=none'
  //  com2:'serial:///dev/ttyAMA0?baudRate=115200&dataBits=8&stopBits=1&parity=none'
}, {/*
    ssl: {
      key: fs.readFileSync('./server.key'),
      cert: fs.readFileSync('./server.crt')
    },*/
  emitEvents: true // default
}, (client) => {
  client.connack({
    returnCode: 0
  })
})
/*
server.listen(() => {
  console.log('listening!')
})
*/
let cnt = 1
function tm() {
  cnt++
  server.publish('msg', [cnt])
  console.log('publish msg')
}
var tmint

var state = new Map()
function sr() {
  let that = state
  server.call('com~46', 'get', []).then((data) => {
    if (data[0] > 1000 || data[0] < 0) {
      that.set('H', NaN)
      that.set('T', NaN)
      that.set('statecode', 200)
      that.set('state', 'online')
    } else {
      that.set('H', data[0] / 10)
      that.set('T', data[1] / 10)
      that.set('statecode', 200)
      that.set('state', 'online')
      console.log(JSON.stringify([...that]))
    }
    return { H: that.get('H'), T: that.get('T') }
  }).catch((err) => {
    that.set('statecode', err.code || 500)
    that.set('state', 'offline')
    console.log('HT err', err)
  })

}

setInterval(sr, 5000)

server.on(server.$connect, function (link) {
  console.log('srv connect', link)
  /*server.subscribe('presence', function (err) {
    if (!err) {
      server.publish('presence', 'Hello mqtt')
    }
  })*/
})


server.on(server.$disconnect, function (link) {
  console.log('srv disconnect')
  /*  server.subscribe('presence', function (err) {
      if (!err) {
        server.publish('presence', 'Hello mqtt')
      }
    })*/
})

server.on(server.$subscribe, (topic) => {
  if (topic === 'msg')
    if (!tmint)
      tmint = setInterval(tm, 1000)
})

server.on(server.$unsubscribe, (topic) => {
  if (topic === 'msg')
    if (tmint) {
      clearInterval(tmint)
      tmint = null
    }
})

server.on(server.$subscribe, function (topic, link) {
  console.log('srv subscribe', link, topic)
})
server.on(server.$unsubscribe, function (topic, link) {
  console.log('srv unsubscribe', link, topic)
})

server.on(server.$message, function (link, addr, topic, message) {
  // message is Buffer
  console.log('message got', topic, message.toString())
  //server.end()
})

server.on('msg', function (message) {
  // message is Buffer
  console.log(message.toString())
  //server.end()
})

server.on('presence', function (message) {
  // message is Buffer
  console.log(message.toString())
  server.emit('msg', '')
  //server.end()
})