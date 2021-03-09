var itmp = require('./index.js')

var client = itmp.connect('ws://127.0.0.1:1884/ws', {
  role: 'client', // role determine who send first message for login client send first message, server wait for message, node connects without login
  realm: 'test client', // realm describes what is it, it can de user, robot, proxy, .... - main function
  token: 'supersecret',
  uid: 'uid'
});
//var server = itmp.createServer('ws://localhost:1884/ws')
var on = false
var onofftm = null

client.on(client.$connected, function (link) {
  console.log('client conn', link)
  client.publish('presence', ['Hello itmp'], true).catch((err) => {
    console.log('publish err')
  })
})

client.setGeneralCall(async (name, args, pars) => {
  console.log('call', name, JSON.stringify(args), JSON.stringify(pars))
  return 'ok msgg'
}
)

client.oncall('get', async (name, args, opts) => {
  console.log('msg called with args', JSON.stringify(args), JSON.stringify(opts))
  return 'ok msgg2'
})


client.on(client.$subscribe, (topic) => {
  console.log('subscribe', topic)
  if (topic === 'msg')
    if (!onofftm)
      onofftm = setInterval(onoff, 10000)
})

client.on(client.$unsubscribe, (topic) => {
  console.log('UNsubscribe', topic)
  if (topic === 'msg')
    if (onofftm) {
      clearInterval(onofftm)
      onofftm = undefined
    }

})

//client.on('msg', msg)
client.once('msg', msg)


function msg(message) {
  console.log('msg', JSON.stringify(message))
}

function onoff() {
  if (!on) {
    client.on('msg', msg)
    on = true
  } else {
    client.removeListener('msg', msg)
    on = false
  }
}