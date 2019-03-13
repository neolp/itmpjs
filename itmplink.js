const EventEmitter = require('events')

class itmplink extends EventEmitter {
  constructor (name) {
    super()
    this.linkname = name

    this.ready = false // link at message level coinnected
    this.connected = false // link at logic level connected

    this.subscriptions = new Map() // map url to object
  }
  setready(ready = true) {
    this.ready = ready
  }
  isready() {
    return this.ready
  }
  setconnected(connected = true) {
    this.connected = connected
  }
  isconnected() {
    return this.connected
  }


}

module.exports = itmplink
