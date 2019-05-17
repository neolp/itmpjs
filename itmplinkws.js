const itmplink = require('./itmplink')
const cbor = require('cbor-sync')
const WebSocket = require('ws')

class ITMPWsLink extends itmplink {
  constructor(name, url, props) {
    super(name)
    if (props === undefined) props = {}
    this.url = url
    this.binary = props.binary !== undefined ? props.binary : true
    this.msgqueue = []
    this.ws = null
  }

  connect() {
    var that = this
    that.ready = false
    if (this.ws) {
      this.ws.close()
    }
    try {
      this.ws = new WebSocket(this.url) // 'ws://www.host.com/path'
    } catch (err) {
      this.ws = null
      //console.log('ITMPWsLink socket create error')
      setTimeout(that.connect.bind(that), 3000)
    }

    this.ws.on('error', function (err) {
      //console.log('ITMPWsLink Error: ', err)
    })
    this.ws.on('message', function (message) {
      let msg
      if (typeof message === 'string') {
        msg = JSON.parse(message)
      } else {
        msg = cbor.decode(message)
      }
      that.emit('message', that, undefined, msg)
    })
    this.ws.on('open', function () { // open logic
      that.ready = true // port opened flag
      that.emit('connect')
      console.log('ws connected')
    })
    this.ws.on('close', function (code, reason) {
      console.log('ITMPWsLink closed ', code, reason)
      that.ready = false
      that.emit('disconnect', code, reason)
      //if (this.settings.autoReconnect && this.reconnectCount < this.settings.reconnectMaxCount) {
      setTimeout(that.connect.bind(that), 3000) //that.settings.reconnectTimeout
      // }
    })
  }
  send(addr, binmsg) {
    if (this.ws && this.ready) {
      try {
        if (this.binary) {
          this.ws.send(cbor.encode(binmsg))
        } else {
          this.ws.send(JSON.stringify(binmsg))
        }
      } catch (err) {
        this.msgqueue.push([addr, binmsg])
      }
    } else {
      this.msgqueue.push([addr, binmsg])
    }
  }

  queueSize() {
    return this.msgqueue.length
  }
  stop() { }
}

module.exports = ITMPWsLink
