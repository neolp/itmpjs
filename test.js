var itmp = require('./itmp4')

var client  = new itmp().connect('ws://localhost:1884/ws')
var on = true
var onofftm = null

client.on(client.$connect, function (link) {
  console.log('client conn',link)
  client.publish('presence', ['Hello itmp'],true)
})

client.on(client.$subscribe, (topic) => {
  if (topic === 'msg')
    if (!onofftm)
      onofftm = setInterval(onoff,10000)
})

client.on(client.$unsubscribe, (topic) => {
  if (topic === 'msg')
    if (onofftm)
      clearInterval( onofftm )
})

//client.on('msg', msg)
client.once('msg', msg)


function msg(message){
  console.log('msg', JSON.stringify(message))
}

function onoff(){
  if (!on) {
    client.on('msg', msg)
    on = true
  } else {
    client.removeListener('msg',msg)
    on = false
  }
}