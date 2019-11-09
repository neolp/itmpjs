const EventEmitter = require('events')

var defaultConnectOptions = {
  keepalive: 60,
  protocolId: 'ws',
  reconnectPeriod: 1000,
  connectTimeout: 30 * 1000,
  resubscribe: true
}

function extractpurename(name) {
  return name.split('~')[0]
}
// itmp error codes and its descriptions
var errors = {
  304: 'Not Modified',
  306: 'No Event',// (if CALL to event topic but no event this time)
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  409: 'Already subscribed',//'Conflict',
  410: 'Gone',
  413: 'Request Entity Too Large',
  414: 'Request-URI Too Large',
  418: 'I\'m a teapot',
  419: 'Format error',
  420: 'Type error',
  429: 'Too Many Requests',
  432: 'No matching subscribers',
  433: 'No subscription existed',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  503: 'Server unavailable',
  505: 'Unacceptable protocol version',
  507: 'Insufficient Storage',
  509: 'Bandwidth Limit Exceeded',
  512: 'Protocol Error',
  521: 'Server Is Down'
}

const knownschemas = {
  ws: './itmplinkws',
  serial: './itmplinkserial'
}

function strdivide(str, divider) {
  let pos = str.indexOf(divider)
  if (pos < 0) return [str, '']
  return [str.substring(0, pos), str.substring(pos + divider.length)]

  // itmp://com:1
  // let delim = name.indexOf(':')
  // if (delim < 0) return [this.connectors.get(name), undefined]
  // return [this.connectors.get(name.substring(0, delim)), name.substring(delim + 1)]
  //    let parts = name.split(':', 2)
  //    return [this.connectors.get(parts[0]), parts[1]]

}
function strdivideend(str, divider) {
  let pos = str.lastIndexOf(divider)
  if (pos < 0) return [str, '']
  return [str.substring(0, pos), str.substring(pos + divider.length)]
}

class itmpConnection {
  constructor(name, link) {
    this.subscriptions = new Map() // map url to object
    this.link = link
    this.name = name
  }
}

class itmpClient extends EventEmitter {
  constructor(cfg) {
    super()
    this.$connect = Symbol('connect') // event fired when client send message connect with connect parameters (event = {uri,opts,block:false})
    this.$connected = Symbol('connected') // event fired wthen client fully connected (and resubscription was finished)
    this.$disconnected = Symbol('disconnected') // event fired when client was disconnected
    this.$subscribe = Symbol('subscribe') //  event fired when client subscribe for topic
    this.$unsubscribe = Symbol('unsubscribe') //  event fired when client unsubscribe for topic
    this.$message = Symbol('message')  //  event fired when client send an event
    this.$error = Symbol('error')  //  event fired when client error
    this.links = new Map() // handle all links without subaddress
    this.cons = new Map() // handle all links together with subaddress
    this.listeners = new Map() // handle all listeners for incoming connection

    this.urls = new Map() // handle all internal urls
    this.msgid = 0 // msg number incremental for transction sequencing
    this.transactions = new Map() // handle unfinished transactions
    this.localsubscriptions = new Map() // handle subscription from local subscribers (programmaticaly subscribed)
    this.localsubscriptionsid = 1 // index of subscription for local subscribers (programmaticaly subscribed)
    this.errors = errors // handle error codes and their descriptions

    // then add/remove listeners subscribe/unsubscribe for that events 
    // TODO refactor this
    this.on('newListener', (eventName) => { // when subscribe new listener (it is from 'events' interface)
      if (typeof eventName === 'string' && eventName !== 'newListener' && eventName !== 'removeListener' && this.listenerCount(eventName) === 0) {
        this._subscribe(eventName)
      }
    })
    this.on('removeListener', (eventName) => { // when unsubscribe the listener (it is from 'events' interface)
      if (typeof eventName === 'string' && eventName !== 'newListener' && eventName !== 'removeListener' && this.listenerCount(eventName) === 0) {
        this._unsubscribe(eventName)
      }
    })
    //configure connections
    if (typeof cfg === 'object') {
      if (cfg.connect) {
        this.connect(cfg.connect)
      }
      if (cfg.listen) {
        this.listen(cfg.listen)
      }
    }
  }

  unsubscribeCon(con) {
    con.subscriptions.forEach((val, uri) => {
      if (val.unsubscribe) {
        val.unsubscribe(uri, null, val)
      }
      this.emit(this.$unsubscribe, uri, val.addr)
    })
    con.subscriptions.clear()

  }


  // add new link (new connection)
  addLink(linkname, link) {
    //const purename = extractpurename(linkname)
    this.links.set(linkname, link)
    //let con = this.addCon(linkname)
    link.on('connect', async () => { // then link connected (become active) send initial CONNECT message and then got answer make link connected
      //      if (link.isconnected()) {
      this.emit(this.$connected, linkname)
      //   return
      // }
      // this.transactionCon(con, undefined, [0, 0, ''], 30000).then(() => {
      //   this.emit(this.$connected, linkname)
      // }).catch((err) => {
      //   //TODO we should do something else
      //   this.emit(this.$connected, linkname, err)
      // })
    })
    link.on('disconnect', () => { // then link disconnected unsubscribe all topics from that link
      link.cons.forEach((con) => {
        this.unsubscribeCon(con)
      })
      this.emit(this.$disconnected, linkname)
    })
    link.on('message', (link, addr, msg) => {
      //      console.log('income message',JSON.stringify(msg))

      let con = this.getConection(addr)
      if (con)
        this.process(con, addr, msg)
    })
  }

  deleteLink(name) {
    let link = this.links.get(name)
    link.cons.forEach((con, conname) => {
      this.unsubscribeCon(con)
      this.cons.delete(conname)
    })
    link.cons.clear()
    this.links.delete(name)
    link.removeAllListeners('connect')
    link.removeAllListeners('disconnect')
    link.removeAllListeners('message')
    link.stop()
  }

  deleteConnection(name) {
    let con = this.cons.get(name)
    this.unsubscribeCon(con)
    this.cons.delete(name)
    con.link.cons.delete(name)
    if (con.link.cons.length === 0) {
      this.deleteLink(con.link.purename)
    }
  }


  addListener(listener) {
    const listenername = listener.listenername
    this.listeners.set(listenername, listener)
  }

  setGeneralCall(call) {
    this.gencall = call
  }

  processConnect(con, addr, id, payload) {
    let [uri, opts] = payload
    if (opts === undefined || typeof opts !== 'object') opts = {}
    let event = { uri, opts, block: false }
    this.emit(this.$connect, event)
    if (event.block) {
      this.answer(addr, [5, id, event.blockcode ? event.blockcode : 403, event.blockreason ? event.blockreason : 'forbidden'])
    } else {
      console.log('got connect restore subscriptions')
      this._resubscribe(con, undefined).then(() => {
        console.log('reconnected')
        this.answer(addr, [1, id, 'ok'])
      })
    }
  }

  processConnected(con, addr, key, payload) {
    // this.processConnect()
    const t = this.transactions.get(key)
    if (t !== undefined) {
      clearTimeout(t.timeout)
      this.transactions.delete(key)
      const [code, message] = payload
      t.resolve([code, message])
      // if (t.err !== undefined) {
      //   t.err(code, message)
      // }
    } else {
      console.log('unexpected connected', key, payload)
    }
  }

  processError(key, payload) {
    const t = this.transactions.get(key)
    if (t !== undefined) {
      clearTimeout(t.timeout)
      this.transactions.delete(key)
      const [code, message] = payload
      t.reject(new Error(code, message))
    } else {
      console.log('unexpected error', payload)
    }
  }

  processCall(con, addr, id, payload) {
    const [uri, args, opts] = payload
    if (this.urls.has(uri)) {
      let node = this.urls.get(uri)
      if (node.call) {
        node.call(uri, args, opts).
          then((ret) => {
            this.answer(addr, [9, id, ret])
          }).
          catch((err) => {
            if (err.code) {
              this.answer(addr, [5, id, err.code, err.message])
            } else {
              this.answer(addr, [5, id, 500, 'internal error'])
            }
          })
      } else {
        this.answer(addr, [5, id, 501, 'no call for this node'])
      }
    } else if (this.gencall) {
      this.gencall(uri, args, opts).
        then((ret) => {
          this.answer(addr, [9, id, ret])
        }).
        catch((err) => {
          if (err.code) {
            this.answer(addr, [5, id, err.code, err.message])
          } else {
            this.answer(addr, [5, id, 500, 'internal error'])
          }
        })
    } else {
      this.answer(addr, [5, id, 404, 'no such call'])
    }
  }

  processResult(key, payload) {
    const t = this.transactions.get(key)
    if (t !== undefined) {
      clearTimeout(t.timeout)
      this.transactions.delete(key)
      // if (typeof t.progress !== 'undefined'){}
      const [result, properties] = payload
      t.resolve(result, properties)
    } else {
      console.log('unexpected result "', key, '" ', payload)// msg);
    }
  }

  processEvent(con, addr, payload) {
    // console.log("event",msg);
    const [topicName, args, opts] = payload
    let node = this.localsubscriptions.get(topicName)
    if (node && node.onMessage) {
      node.lastMessage = { topic: topicName, args, opts, con, addr }
      node.onMessage(topicName, args, opts)
    }
    if (Array.isArray(args)) {
      this.emit(this.$message, con, addr, topicName, args, opts)
      this.emit(topicName, ...args, opts)
    } else {
      this.emit(this.$message, con, addr, topicName, args, opts)
      this.emit(topicName, args, opts)
    }
    //this.model.processIncomeEvent(con.connected ? `${con.connected.con}/${topic}` : `${addr}/${topic}`, args, ots)
  }

  processPublish(con, addr, id, payload) {
    // console.log("event",msg);
    const [topicName, args, opts] = payload
    let node = this.localsubscriptions.get(topicName)
    if (node && node.onMessage) {
      node.lastMessage = { topic: topicName, args, opts, con, addr }
      node.onMessage(topicName, args, opts)
    }
    if (Array.isArray(args)) {
      this.emit(this.$message, con, addr, topicName, args, opts)
      this.emit(topicName, ...args, opts)
    } else {
      this.emit(this.$message, con, addr, topicName, args, opts)
      this.emit(topicName, args, opts)
    }
    this.answer(addr, [15, id])
  }

  processSubscribe(con, addr, id, payload) {
    const [originaluri, opts] = payload
    let uri
    if (con.connected) {
      //console.log('linked subscribe', addr, ' for ', originaluri)
      uri = `area${con.connected.con}/${originaluri}`
    } else {
      uri = originaluri
    }
    //console.log('subscribe', addr, ' for ', uri)

    if (!con.subscriptions.has(originaluri)) {
      const s = { con, addr/*, emit:this.emitEvent.bind(this)*/ }
      //const ret = this.model.subscribe(uri, opts, s)
      //if (ret === undefined) {
      //console.log(`fault subs${JSON.stringify(payload)}`)
      //this.answer(addr, [5, id, 404, 'no such uri'])
      //} else {
      if (typeof originaluri === 'string' && originaluri.length > 0) {
        con.subscriptions.set(originaluri, s)
        try {
          this.emit(this.$subscribe, originaluri, addr, opts)
          this.answer(addr, [17, id])
        } catch (err) {
          this.answer(addr, [5, id, 500, err.message])
        }
      } else {
        this.answer(addr, [5, id, 400, 'wrong topic'])
      }

      //}
    } else {
      this.answer(addr, [5, id, 409, 'already subscribed'])
    }
  }
  processUnsubscribe(con, addr, id, payload) {
    const [uri, opts] = payload
    //console.log('unsubscribe', addr, ' at ', uri)
    const s = con.subscriptions.get(uri)
    if (s !== undefined) {
      let ret
      if (s.unsubscribe) {
        ret = s.unsubscribe(uri, opts, s)
      }
      con.subscriptions.delete(uri)
      this.answer(addr, [19, id, ret])
      this.emit(this.$unsubscribe, uri, addr, opts)
    } else {
      console.log(`unexpected subs${JSON.stringify(payload)}`)
      this.answer(addr, [5, id, 404, 'no such uri'])
    }
  }

  processDescribe(addr, id, payload) {
    const [uri, args, opts] = payload
    let ret = this.model.describe(uri, opts)
    if (ret !== undefined) {
      this.answer(addr, [7, id, ret])
    } else {
      console.log(`unexpected descr${JSON.stringify(payload)}`)
      this.answer(addr, [5, id, 404, 'no such uri'])
    }
  }

  processSubscribed(con, addr, key, payload) {
    const t = this.transactions.get(key)
    if (t !== undefined) {
      this.transactions.delete(key)
      clearTimeout(t.timeout)
      t.resolve(payload)
    } else {
      console.log('unexpected subscribed', key, payload)
    }
  }

  processUnsubscribed(con, addr, key, payload) {
    const t = this.transactions.get(key)
    if (t !== undefined) {
      clearTimeout(t.timeout)
      this.transactions.delete(key)
      const [, opts] = payload // id, opts
      t.resolve(opts)
    } else {
      console.log('unexpected unsubscribe', payload)
    }
  }

  process(con, addr, msg) {
    if (Array.isArray(msg) && msg.length >= 1 && typeof msg[0] === 'number') {
      let [command, ...payload] = msg
      let key
      let id
      if (msg.length >= 1 && typeof msg[1] === 'number') {
        [id, ...payload] = payload
        key = `${addr}:${id}`
      } else {
        key = `${addr}:`
        id = ''
      }

      switch (command) {
      case 0: // [CONNECT, Connection:id, Realm:uri, Details:dict] open connection
        this.processConnect(con, addr, id, payload)
        break
      case 1: // [CONNECTED, CONNECT.Connection:id, Session:id, Details:dict] confirm connection
        this.processConnected(con, addr, key, payload)
        break
      case 2: // [ABORT, Code:integer, Reason:string, Details:dict] terminate connection
      case 4: // [DISCONNECT, Code:integer, Reason:string, Details:dict] clear finish connection
      case 5: // [ERROR, Request:id, Code:integer, Reason:string, Details:dict] error notificarion
        this.processError(key, payload)
        break
      case 6: // [DESCRIBE, Request:id, Topic:uri, Options:dict] get description
        this.processDescribe(addr, id, payload)
        break
      case 7: // [DESCRIPTION, DESCRIBE.Request:id, description:list, Options:dict] response
        this.processResult(key, payload)
        break
        // RPC -----------------------------
      case 8: // [CALL, Request:id, Procedure:uri, Arguments, Options:dict] call
        this.processCall(con, addr, id, payload)
        break
      case 9: // [RESULT, CALL.Request:id, Result, Details:dict] call response
        this.processResult(key, payload)
        break
        // RPC Extended
      case 10: // [ARGUMENTS, CALL.Request:id,ARGUMENTS.Sequuence:integer,Arguments,Options:dict]
        //  additional arguments for call
        break
      case 11: // [PROGRESS, CALL.Request:id, PROGRESS.Sequuence:integer, Result, Details:dict]
        //  call in progress
        break
      case 12: // [CANCEL, CALL.Request:id, Details:dict] call cancel
        // publish
        break
        // events and sub/pub ---------------------
      case 13: // [EVENT, Request:id, Topic:uri, Arguments, Options:dict] event
        this.processEvent(con, addr, payload)
        break
      case 14: // [PUBLISH, Request:id, Topic:uri, Arguments, Options:dict] event with acknowledge
        this.processPublish(con, addr, id, payload)
        //console.log('publish', msg)
        break
      case 15: // [PUBLISHED, PUBLISH.Request:id, Publication:id, Options:dict] event acknowledged
        //console.log('published', msg)
        this.processResult(key, payload)
        break
        // subscribe
      case 16: // [SUBSCRIBE, Request:id, Topic:uri, Options:dict] subscribe
        this.processSubscribe(con, addr, id, payload)
        break
      case 17: // [SUBSCRIBED, SUBSCRIBE.Request:id, Options:dict] subscription confirmed
        this.processSubscribed(con, addr, key, payload)
        break
      case 18: // [UNSUBSCRIBE, Request:id, Topic:uri, Options:dict]
        this.processUnsubscribe(con, addr, id, payload)
        break
      case 19: // [UNSUBSCRIBED, UNSUBSCRIBE.Request:id, Options:dict]
        this.processUnsubscribed(con, addr, key, payload)
        break
        // keep alive
      case 33: // [KEEP_ALIVE, Request:id, Options:dict] keep alive request
      case 34: // [KEEP_ALIVE_RESP, KEEP_ALIVE.Request:id, Options:dict] keep alive responce
      default:
      }
    } else {
      console.log('wrong message ', msg)
    }
  }

  answer(addr, msg) {
    const con = this.cons.get(addr)
    if (!con) {
      throw new Error('no link')
    }
    con.link.send(addr, msg)
  }

  transactionCon(con, addr, msg, timeout = 600) {
    if (typeof con !== 'object') {
      return Promise.reject(new Error('500 no such link'))
    }

    // TODO move transactions keys to con
    var that = this
    if (typeof msg[1] === 'number') {
      this.msgid++
      if (this.msgid > 0x17) { // to store id in single byte in CBOR encoding
        this.msgid = 1
      }
      while (that.transactions.has(this.msgid)) {
        this.msgid++
      }
      msg[1] = this.msgid
    } else {
      return Promise.reject(new Error('500 wrong message')) //console.log('wrong message')
    }

    /* let sent = */ con.link.send(addr, msg)
    const key = `${addr}:${msg[1]}`
    return new Promise((resolve, reject) => {
      const timerId = setTimeout((tkey) => {
        that.transactions.delete(tkey)
        reject(new Error('504 timeout'))
      }, timeout, key)
      that.transactions.set(key, { resolve, reject, timeout: timerId, msg })
    })
  }

  getConection(addr) {
    let con = this.cons.get(addr)
    if (con) return con
    let link = this.links.get(extractpurename(addr))
    if (!link) return undefined
    con = new itmpConnection(addr, link)
    link.cons.set(addr, con)
    this.cons.set(addr, con)
    return con
  }
  transaction(addr, msg, timeout = 600) {
    let con = this.getConection(addr)
    if (!con) {
      if (!con)
        return Promise.reject(new Error('no such link'))
    }
    return this.transactionCon(con, addr, msg, timeout)
  }

  _resubscribe(con, subaddr) {
    const that = this
    //    return this.transactionLink(con, subaddr, [0,0,'']).then(()=>{
    const rets = []
    that.eventNames().forEach((topicName) => {
      if (typeof topicName === 'string' && topicName !== 'newListener' && topicName !== 'removeListener') {
        rets.push(that.transactionCon(con, subaddr, [16, 0, topicName]))
      }

    })
    return Promise.all(rets).catch(() => {
      console.log('subscribe error')
    })
    //    })
  }
  /*
  // TODO
  // rewrite this to use sub paths
  emitEvent (addr, topic, msg) {
    this.links.forEach((link, key, map) => {
      const to = link.subscriptions.get(topic)
      if (to) {
        const [link, subaddr] = this.getLink(to.addr) // link, subaddr, uri = ''
        if (typeof link === 'object') {
          const id = this.msgid++
          link.send(subaddr, [13, id, topic, msg])
        }
      }
    })
  }

  sendEvent (addr, topic, msg) {
    const [link, subaddr] = this.getLink(addr) // link, subaddr, uri = ''
    if (typeof link === 'object') {
      const id = this.msgid++
      link.send(subaddr, [13, id, topic, msg])
    }
  }
*/
  getLink(addr) {
    if (!addr) {
      if (this.links.length === 1) {
        let lnk = this.links.values().next().value
        return [lnk, '']
      }
    }
    const [linkname, subaddr] = strdivideend(addr, '~') //addr.split(':', 2)
    const link = this.links.get(linkname)

    return [link, subaddr]
  }

  // publish('reset')
  // publish('setspeed',[12,45])
  // publish('com/4','alarm')
  // publish('com/4','speed',[12,45])
  publishEvent(addr, topic, message, opts) {
    if (typeof addr === 'object' && addr !== null) {
      message = addr.message
      topic = addr.topic
      addr = addr.address
    } else if (arguments.length < 4 && typeof topic !== 'string') { // no address at all
      opts = message
      message = topic
      topic = addr
      addr = undefined
    }
    const msg = [14, 0, topic, message, opts] // 14 - publish message, 15 - published message
    return this.transaction(addr, msg)
  }

  // sendEvent('com/4','reset',[12,45])
  // sendEvent('com/4','setspeed',[12,45])
  sendEvent(addr, topic, msg, opts) {
    let con = this.cons.get(addr)
    if (con) {
      const id = this.msgid++
      return con.link.send(addr, [13, id, topic, msg, opts])
    }
    return Promise.reject('wrong addr')
  }

  // publish('speed',[12,45])
  sendEventAllSubscribed(topic, msg) {
    this.cons.forEach((con, key, map) => {
      const to = con.subscriptions.get(topic)
      if (to) {
        const id = this.msgid++
        con.con.send(to ? to.subaddr : undefined, [13, id, topic, msg])
      }
    })
  }

  // call('com/4','reset')
  // call('com/4','setspeed',[12,45])
  call(addr, name, args) {
    return this.transaction(addr, [8, 0, name, args])
  }

  // subscribe('topic')
  // subscribe('topic', (msg)=>{} )
  // subscribe('topic', {retain:'dead'} )
  // subscribe('topic', {retain:'dead'}, (msg)=>{} )
  // subscribe('address', 'topic')  subscribe for topic from specific con
  // subscribe('address', 'topic', (msg)=>{})
  // subscribe('address', 'topic', {retain:'dead'})
  // subscribe('address', 'topic', {retain:'dead'}, (msg)=>{})
  _subscribe(addr, topicName, params, onevent) {
    if (typeof addr === 'object' && addr !== null) {
      topicName = addr.topic
      params = addr.parameters
      onevent = addr.onevent
      addr = addr.address
    } else {
      if (typeof topicName !== 'string') { // no address at all (1,2,3,4)
        onevent = params
        params = topicName
        topicName = addr
        addr = undefined
      }
      if (typeof params === 'function') {
        onevent = params
        params = undefined
      }
    }
    /*
    if (this.localsubscriptions.has(topicName)){
      let s = this.localsubscriptions.get(topicName)
      if (s.handlers.has(onevent)) {
        s.handlers.get(onevent).count += 1 // increment subscribers number
      } else {
        s.handlers.set(onevent, {count:1})
      }
      return Promise.resolve()
    } else {
      let handlers = new Map()
      handlers.set(onevent, {count:1})
      this.localsubscriptions.set(topicName, { addr, topic: topicName, handlers })//`${addr}/${topic}`
      */
    const rets = []
    const msg = [16, 0, topicName, params]
    this.links.forEach((lnk) => {
      if (lnk.ready)
        rets.push(this.transactionLink(lnk, undefined, msg))
    })
    if (rets.length > 0) {
      return Promise.all(rets).catch(() => {
        console.log('subscribe error')
      })
    } else {
      return Promise.resolve()
    }
    //}
  }

  // unsubscribe('topic')
  // unsubscribe('address', 'topic')  unsubscribe from topic from specific con
  _unsubscribe(addr, topicName) {
    if (typeof addr === 'object' && addr !== null) {
      topicName = addr.topic
      addr = addr.address
    } else {
      if (typeof topicName !== 'string') { // no address at all (1,2,3,4)
        topicName = addr
        addr = undefined
      }
    }
    /*
    if (this.localsubscriptions.has(topicName)){
      let s = this.localsubscriptions.get(topicName)
      if (s.handlers.has(onevent)) {
        s.handlers.get(onevent).count += 1 // increment subscribers number
      } else {
        s.handlers.set(onevent, {count:1})
      }
      return Promise.resolve()
    } else {
      let handlers = new Map()
      handlers.set(onevent, {count:1})
      this.localsubscriptions.set(topicName, { addr, topic: topicName, handlers })//`${addr}/${topic}`
      */
    const rets = []
    const msg = [18, 0, topicName]
    this.links.forEach((lnk) => {
      if (lnk.ready)
        rets.push(this.transactionLink(lnk, undefined, msg))
    })
    if (rets.length > 0) {
      return Promise.all(rets).catch(() => {
        console.log('unsubscribe error')
      })
    } else {
      return Promise.resolve()
    }
    //return this.transaction(addr, msg).then( ()=>{ return id } )

    //    const msg = [18, 0, topic, param]
    //return this.transaction(addr, msg)
  }

  // describe('topic')
  // describe('address', 'topic')
  describe(addr, topic) {
    if (typeof addr === 'object' && addr !== null) {
      topic = addr.topic
      addr = addr.address
    } else if (typeof topic !== 'string') { // no address at all
      topic = addr
      addr = undefined
    }

    const msg = [6, 0, topic]
    return this.transaction(addr, msg)
  }

  describe(addr, name) {
    const msg = [6, 0, name]
    return this.transaction(addr, msg)
  }
  /*

please rewrite this
  subscribe (addr, url, param, onevent) {
    const msg = [16, 0, url, param]
    let that = this
    return this.transaction(addr, msg).then((value) => {
      that.subscriptions.set(`${addr}/${url}`, { onevent: onevent })
    })
  }

  unsubscribe (addr, url, param) {
    const subskey = `${addr}/${url}`
    const t = this.subscriptions.get(subskey)
    if (t !== undefined) {
      this.subscriptions.delete(subskey)
      const msg = [18, 0, url, param]
      return this.transaction(addr, msg)
    }
    return Promise.reject(new Error('404 subscription not found'))
    // err(404, 'subscription not found')
  }
*/
  queueSize(addr) {
    let subaddr = ''
    let linkname = ''
    if (typeof addr === 'string') {
      const addrparts = strdivide(addr, '/') //addr.split('/', 2)
      //TODO REFACTOR THIS
      if (Array.isArray(addrparts)) {
        linkname = addrparts[0]
        subaddr = addrparts[1]
      } else {
        linkname = addr
      }
    }
    const con = this.links.get(linkname)
    if (typeof con !== 'object') {
      return -1
    }

    return con.queueSize(subaddr)
  }

  prepareLink(url) {
    let urlparts = strdivide(url, '://')
    const parsedurl = new URL(url)
    let purename = extractpurename(parsedurl.host)
    if (this.links.has(purename))
      return

    this.connect(url)
  }
  connect(urls, opts) {
    opts = Object.assign({}, defaultConnectOptions, opts)
    if (typeof urls === 'string') urls = [urls]
    for (let index in urls) {
      let url = urls[index]
      if (typeof url === 'string') {
        let urlparts = strdivide(url, '://')
        let linkref = knownschemas[urlparts[0]]
        if (linkref) {
          let Link = require(linkref)
          let link = new Link(index, url, opts)
          this.addLink(index, link)
          link.connect()
        }
      }
    }
    return this
  }

  listen(urls, opts) {
    if (typeof urls === 'string') urls = [urls]
    for (let index in urls) {
      let url = urls[index]
      if (typeof url === 'string') {
        if (url.startsWith('ws://')) {
          let Srv = require('./itmplinkserverws')
          let srv = new Srv(this, url, opts)
          this.addListener(srv)
        }
      } else {
        if (index.startsWith('ws') || url.scheme.startsWith('ws')) {
          let Srv = require('./itmplinkserverws')
          let srv = new Srv(this, undefined, Object.assign({}, opts, url))
          this.addListener(srv)
        }
      }
    }
    return this
  }

}

itmpClient.serial = function (cfg) {
  return new itmpClient(cfg)
}

module.exports = itmpClient
