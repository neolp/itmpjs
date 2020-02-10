var itmp = require('./index.js')


var tmint

let wsclient;
const server = itmp.createServer('ws://localhost:1884/ws', {
  role: 'server', // role determine who send first message for login client send first message, server wait for message, node connects without login
  realm: 'test server', // realm describes what is it, it can de user, robot, proxy, .... - main function
  token: 'supersecret',
  uid: 'uid'
}, (newclient) => {
  //newclient.stop()
  //return false;
  wsclient = newclient

  wsclient.on(wsclient.$login, function (login) {
    console.log('srv login', JSON.stringify(login))
    if (login.token != 'supersecret') {
      login.block = true
    }
  })

  wsclient.on(wsclient.$connected, function (link) {
    console.log('srv connected', link)
    /*wsclient.subscribe('presence', function (err) {
      if (!err) {
        wsclient.publish('presence', 'Hello mqtt')
      }
    })*/
  })


  wsclient.on(wsclient.$disconnected, function (link) {
    console.log('srv disconnect')
    /*  wsclient.subscribe('presence', function (err) {
        if (!err) {
          wsclient.publish('presence', 'Hello mqtt')
        }
      })*/
  })

  wsclient.on(wsclient.$subscribe, (topic) => {
    console.log('srv subscribe', topic)
    if (topic === 'msg')
      if (!tmint)
        tmint = setInterval(tm, 1000)
  })

  wsclient.on(wsclient.$unsubscribe, (topic) => {
    console.log('srv unsubscribe', topic)
    if (topic === 'msg')
      if (tmint) {
        clearInterval(tmint)
        tmint = null
      }
  })

  wsclient.on(wsclient.$message, function (link, topic, message, opts) {
    // message is Buffer
    console.log('message got', JSON.stringify(topic), JSON.stringify(message), JSON.stringify(opts))
    //wsclient.end()
  })

  wsclient.on('msg', function (message, opts) {  // in fact subscribe for external events
    // message is Buffer
    console.log('msg subscription message', JSON.stringify(message), JSON.stringify(opts))
    //wsclient.end()
  })

  wsclient.on('presence', function (message, opts) {
    // message is Buffer
    console.log('presence subscription message', JSON.stringify(message), JSON.stringify(opts))
    wsclient.emit('msg', '')
    //wsclient.end()
  })
});

//const client = itmp.connect('serial://COM3?baudRate=115200&dataBits=8&stopBits=1&parity=none~1', () => { return true })

let cnt = 1
function tm() {
  if (!wsclient) return
  cnt++
  wsclient.publish('msg', [cnt]).then((res) => {
    console.log('published msg', cnt)
  }).catch((res) => {
    console.log('NOT published msg', cnt)
  })
  console.log('publish msg', cnt)
}

var state = new Map()
function sr() {
  let that = state
  if (!wsclient) {
    console.log('no client')
    return
  }
  wsclient.call('get', ['get arg'], { opts: true }).then((data) => {
    console.log('call result', data)
  }).catch((err) => {
    console.log('HT err', err)
  })
}

setInterval(sr, 5000)

