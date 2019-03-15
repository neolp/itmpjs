const EventEmitter = require('events')
const url = require('url')
const itmplink = require('./itmplink')
const cbor = require('cbor-sync')

class ITMPWsServerLink extends itmplink
{
  constructor(name, itmp, ws)
  {
    super(name)
    this.itmp = itmp
    this.ws = ws
    this.msgqueue = []
    this.ready = true
    const that = this
    this.ws.on('error', (err) => {
      console.log('Error: ', err.message)
    })
    this.ws.on('open', () => {
      console.log('opened')
      this.isAlive = true
    })
    this.ws.on('message', (message) => {
      let msg
      if (typeof message === 'string') {
        msg = JSON.parse(message)
      } else {
        msg = cbor.decode(message)
      }
      that.emit('message',that, undefined, msg)
      //console.log(msg)
      //if (typeof this.itmp.process === 'function') {  this.itmp.process(this, addr, msg)  }
    })
    this.ws.on('open', () => {
      this.ready = true // port opened flag
      this.emit('connect',this)

/*      while (this.msgqueue.length > 0)
      {
        const [addr, binmsg] = this.msgqueue.shift()
        this.send(addr, binmsg)
      }*/
    })
    this.ws.on('pong', () =>
    {
      this.isAlive = true
    })
    this.ws.on('close', (code, reason) =>
    {
      that.emit('disconnect',that)
      clearInterval(this.interval)
      this.interval = undefined
      console.log('closed ', name, code, reason)
      this.ready = false
      this.itmp.deleteConnection(this.linkname)
    })
    this.interval = setInterval(() => {
      if (this.isAlive === false) {
        return this.ws.terminate()
      }
      this.isAlive = false
      try{
        this.ws.ping(() => {})
      } catch ( er ) {
      }
    }, 30000)

    setImmediate(()=>{
      that.emit('connect',that)
    })
  }

  send(addr, binmsg)
  {
    if (this.ready)
    {
      try
      {
        //this.ws.send(JSON.stringify(binmsg))
      //  console.log(binmsg)
        let cmsg = cbor.encode(binmsg)
        //console.log(cmsg)
        this.ws.send(cmsg)
        this.sendlevel = this.ws._sender.queue.length
        this.sendamount = this.ws._sender.bufferedBytes
        //console.log(123456)
      }
      catch (err)
      {}
    }
    else
    {
      this.msgqueue.push([addr, binmsg])
    }
  }

  queueSize()
  {
    return this.msgqueue.length
  }
}

class ITMPWsServer extends EventEmitter
{
  constructor(itmp, name, opts)
  {
    super()
    this.itmp=itmp
    let path


    if (opts && opts.expressapp) {
      this.app = opts.expressapp
      path = opts.url || '/'
    } else {
      const wsurl = url.parse(name)
      const port = wsurl.port || 80
      path = wsurl.pathname
      const that = this
      const express = require('express')
      const expressws = require('express-ws')
      this.app = express()
      expressws(this.app)
      // start server!
      this.server = this.app.listen(port, () => {
        that.emit('connect',that)
        console.log(`App listening on address '${this.server.address().address}' and port ${this.server.address().port}`)
      })
    }

    this.app.ws(path, (ws, req) => {
      let link
      if (req.connection.remoteFamily === 'IPv6') {
        link = new ITMPWsServerLink(`ws:[${req.connection.remoteAddress}]:${req.connection.remotePort}`, this.itmp, ws)
      } else {
        link = new ITMPWsServerLink(`ws:${req.connection.remoteAddress}:${req.connection.remotePort}`, this.itmp, ws)
      }
      itmp.addLink(link)
      //console.log(`connected ws:[${req.connection.remoteAddress}]:${req.connection.remotePort}`)
    })
  }


}

module.exports = ITMPWsServer
