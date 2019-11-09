const EventEmitter = require('events')

class itmplink extends EventEmitter {
  constructor(purename, url) {
    super()
    this.purename = purename // name without subaddress or full name if link without subaddresses at all
    this.linkurl = url
    this.cons = new Map()

    this.ready = false // link at message level coinnected
    this.connected = false // link at logic level connected
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
