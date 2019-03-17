const EventEmitter = require('events')

var defaultConnectOptions = {
  keepalive: 60,
  protocolId: 'ws',
  reconnectPeriod: 1000,
  connectTimeout: 30 * 1000,
  resubscribe: true
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
  ws:'./itmplinkws',
  serial:'./itmplinkserial'
}

class itmpClient extends EventEmitter {
  constructor () {
    super()
    this.$connect = Symbol('connect') // event fired when client send message connect with connect parameters (event = {uri,opts,block:false})
    this.$connected = Symbol('connected') // event fired wthen client fully connected (and resubscription was finished)
    this.$disconnected = Symbol('disconnected') // event fired when client was disconnected
    this.$subscribe = Symbol('subscribe') //  event fired when client subscribe for topic
    this.$unsubscribe = Symbol('unsubscribe') //  event fired when client unsubscribe for topic
    this.$message = Symbol('message')  //  event fired when client send an event
    this.links = new Map() // handle all links
    this.listeners = new Map() // handle all listeners for incoming connection
    
    this.urls = new Map() // handle all internal urls
    this.msgid = 0 // msg number incremental for transction sequencing
    this.transactions = new Map() // handle unfinished transactions
    this.localsubscriptions = new Map() // handle subscription from local subscribers (programmaticaly subscribed)
    this.localsubscriptionsid = 1 // index of subscription for local subscribers (programmaticaly subscribed)
    this.errors = errors // handle error codes and their descriptions

    this.on('newListener', (eventName, listener) => { // when subscribe new listener (it is from 'events' interface)
      if (typeof eventName === 'string' && eventName!=='newListener' && eventName!=='removeListener' && this.listenerCount(eventName) === 0) {
        this._subscribe(eventName)
      }
    }) 
    this.on('removeListener', (eventName, listener) => { // when unsubscribe the listener (it is from 'events' interface)
      if (typeof eventName === 'string'  && eventName!=='newListener' && eventName!=='removeListener' &&  this.listenerCount(eventName) === 0) {
        this._unsubscribe(eventName)
      }
    })
  }

  // add new link (new connection)
  addLink (link) {
    const linkname = link.linkname
    this.links.set(linkname, link)
    link.on('connect', async ()=>{ // then link connected (become active) send initial CONNECT message and then got answer make link connected
      this.transactionLink(link, undefined, [0,0,''], 30000).then(()=>{
        this.emit(this.$connected, linkname)
      }).catch( (err) => {
        //TODO we should do something else
        this.emit(this.$connected, linkname)
      })
    })
    link.on('disconnect', ()=>{ // then link disconnected unsubscribe all topics from thet link
      link.subscriptions.forEach((val, uri) => {
        if (val.unsubscribe) {
          val.unsubscribe(uri, null, val)
        }
        this.emit(this.$unsubscribe, uri, val.addr)
      })
      link.subscriptions.clear()
      this.emit(this.$disconnected)
    })
    link.on('message', (link, subaddr, msg)=>{
      //      console.log('income message',JSON.stringify(msg))
      this.process(link, subaddr, msg)
    })
  }
  addListener(listener) {
    const listenername = listener.listenername
    this.listeners.set(listenername, listener)
  }

  deleteConnection (name) {
    let link = this.links.get(name)
    if (this.model) {
      this.model.disconnect(link)
    }
    // remove incoming subscriptions
    link.subscriptions.forEach((val, uri) => {
      if (val.unsubscribe) {
        val.unsubscribe(uri, null, val)
      }
      this.emit(this.$unsubscribe, uri, val)
    })
    link.subscriptions.clear()
    link.removeAllListeners('connect')
    link.removeAllListeners('disconnect')
    link.removeAllListeners('message')
    this.links.delete(name)
  }

  processConnect (link, addr, id, payload) {
    let [uri, opts] = payload
    if (opts === undefined || typeof opts !== 'object') opts = {}
    let event = {uri,opts,block:false}
    this.off.emit(this.$connect, event)
    if (event.block) {
      this.answer(addr, [5, id, event.blockcode?event.blockcode:403, event.blockreason?event.blockreason:'forbidden'])
    } else {
      console.log('got connect restore subscriptions')
      this._resubscribe(link, undefined).then(()=>{
        console.log('reconnected')
        this.answer(addr, [1, id, 'ok'])
      })
    }
  }

  processConnected (link, addr, key, payload) {
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

  processError (key, payload) {
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

  processCall (link, addr, id, payload) {
    const [uri, args, opts] = payload
    if (this.urls.has(uri)) {
      let node = this.urls.get(uri)
      if (node.call) { 
        node.call(uri, args, opts).
          then((ret)=> {
            this.answer(addr, [9, id, ret])
          }).
          catch((err)=>{
            if (err.code) {
              this.answer(addr, [5, id, err.code, err.message])
            } else {
              this.answer(addr, [5, id, 500, 'internal error'])
            }
          })
      } else {
        this.answer(addr, [5, id, 501, 'no call for this node'])
      }
    } else {
      this.answer(addr, [5, id, 404, 'no such call'])
    }
  }

  processResult (key, payload) {
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

  processEvent (link, addr, payload) {
    // console.log("event",msg);
    const [topicName, args, opts] = payload
    let node = this.localsubscriptions.get(topicName)
    if (node && node.onMessage) {
      node.lastMessage = {topic: topicName, args, opts, link, addr}
      node.onMessage(topicName, args, opts)
    }
    if (Array.isArray (args)) {
      this.emit(this.$message, link, addr, topicName, args, opts)
      this.emit(topicName, ...args, opts)
    } else {
      this.emit(this.$message, link, addr, topicName, args, opts)
      this.emit(topicName, args, opts)
    }
    //this.model.processIncomeEvent(link.connected ? `${link.connected.link}/${topic}` : `${addr}/${topic}`, args, ots)
  }

  processSubscribe (link, addr, id, payload) {
    const [originaluri, opts] = payload
    let uri
    if (link.connected) {
      //console.log('linked subscribe', addr, ' for ', originaluri)
      uri = `area${link.connected.link}/${originaluri}`
    } else {
      uri = originaluri
    }
    //console.log('subscribe', addr, ' for ', uri)

    if (!link.subscriptions.has(originaluri)) {
      const s = { link, addr/*, emit:this.emitEvent.bind(this)*/ }
      //const ret = this.model.subscribe(uri, opts, s)
      //if (ret === undefined) {
      //console.log(`fault subs${JSON.stringify(payload)}`)
      //this.answer(addr, [5, id, 404, 'no such uri'])
      //} else {
      if (typeof originaluri === 'string' && originaluri.length > 0) {
        link.subscriptions.set(originaluri, s)
        try {
          this.emit(this.$subscribe, originaluri, addr)
          this.answer(addr, [17, id])
        } catch (err){
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
  processUnsubscribe (link, addr, id, payload) {
    const [uri, opts] = payload
    //console.log('unsubscribe', addr, ' at ', uri)
    const s = link.subscriptions.get(uri)
    if (s !== undefined) {
      let ret
      if (s.unsubscribe) {
        ret = s.unsubscribe(uri, opts, s)
      }
      link.subscriptions.delete(uri)
      this.answer(addr, [19, id, ret])
      this.emit(this.$unsubscribe, uri, addr)
    } else {
      console.log(`unexpected subs${JSON.stringify(payload)}`)
      this.answer(addr, [5, id, 404, 'no such uri'])
    }
  }

  processDescribe (addr, id, payload) {
    const [uri, args, opts] = payload
    let ret = this.model.describe(uri,opts)
    if (ret !== undefined) {
      this.answer(addr, [7, id, ret])
    } else {
      console.log(`unexpected descr${JSON.stringify(payload)}`)
      this.answer(addr, [5, id, 404, 'no such uri'])
    }
  }

  processSubscribed (link, addr, key, payload) {
    const t = this.transactions.get(key)
    if (t !== undefined) {
      this.transactions.delete(key)
      clearTimeout(t.timeout)
      t.resolve(payload)
    } else {
      console.log('unexpected subscribed', key, payload)
    }
  }

  processUnsubscribed (link, addr, key, payload) {
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

  process (link, addr, msg) {
    if (typeof addr === 'undefined' || (typeof addr === 'string' && addr.length === 0)) {
      addr = link.linkname
    } else {
      addr = `${link.linkname}#${addr}`
    }
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
        this.processConnect(link, addr, id, payload)
        break
      case 1: // [CONNECTED, CONNECT.Connection:id, Session:id, Details:dict] confirm connection
        this.processConnected(link, addr, key, payload)
        break
      case 2: // [ABORT, Code:integer, Reason:string, Details:dict] terminate connection
      case 4: // [DISCONNECT, Code:integer, Reason:string, Details:dict] clear finish connection
      case 5: // [ERROR, Request:id, Code:integer, Reason:string, Details:dict] error notificarion
        this.processError(key, payload)
        break
      case 6: // [DESCRIBE, Request:id, Topic:uri, Options:dict] get description
        this.processDescribe(addr, id, payload)
        break
      case 7: { // [DESCRIPTION, DESCRIBE.Request:id, description:list, Options:dict] response
        const t = this.transactions.get(key)
        if (t !== undefined) {
          clearTimeout(t.timeout)
          this.transactions.delete(key)
          const [result, properties] = payload
          t.resolve(result, properties)
        } else {
          console.log('unexpected result', JSON.stringify(msg))
        }
        break
      }
      // RPC
      case 8: // [CALL, Request:id, Procedure:uri, Arguments, Options:dict] call
        this.processCall(link, addr, id, payload)
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
      case 13: // [EVENT, Request:id, Topic:uri, Arguments, Options:dict] event
        this.processEvent(link, addr, payload)
        break
      case 14: // [PUBLISH, Request:id, Topic:uri, Arguments, Options:dict] event with acknowledge
        console.log('publish', msg)
        break
      case 15: // [PUBLISHED, PUBLISH.Request:id, Publication:id, Options:dict] event acknowledged
        console.log('published', msg)
        break
        // subscribe
      case 16: // [SUBSCRIBE, Request:id, Topic:uri, Options:dict] subscribe
        this.processSubscribe(link, addr, id, payload)
        break
      case 17: // [SUBSCRIBED, SUBSCRIBE.Request:id, Options:dict] subscription confirmed
        this.processSubscribed(link, addr, key, payload)
        break
      case 18: // [UNSUBSCRIBE, Request:id, Topic:uri, Options:dict]
        this.processUnsubscribe(link, addr, id, payload)
        break
      case 19: // [UNSUBSCRIBED, UNSUBSCRIBE.Request:id, Options:dict]
        this.processUnsubscribed(link, addr, key, payload)
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

  answer (addr, msg, err) {
    let subaddr = ''
    let linkname = ''
    if (typeof addr === 'string') {
      const addrparts = addr.split('/', 2)
      if (Array.isArray(addrparts)) {
        linkname = addrparts[0]
        subaddr = addrparts[1]
      } else {
        linkname = addr
      }
    }
    const link = this.links.get(linkname)
    if (typeof link !== 'object' && typeof err === 'function') {
      err(500, 'no link')
    }

    // let that = this;

    link.send(subaddr, msg)
    // var key = addr+":"+((typeof msg[1] === "number" ) ? msg[1] : "");
    // var timerId = setTimeout( (key)=>{ var prom = that.transactions.get(key);
    // that.transactions.delete(key); prom.err("timeout");
    // }, 2000, key);
    // that.transactions.set(key, {'done':done, 'err':err, 'timeout':timerId, 'msg':msg} );
  }
/*
  getLink (addr) {
    const [linkname, subaddr, uri] = addr.split('/', 3)
    let link
    let lnkname
    if (this.links.length === 1){
      for ( [lnkname, link] of this.links.entries()) {
      }
      if (lnkname.length!==0){
        link = undefined
      }
    }
    if (!link) link = this.links.get(linkname)
    if (!link || !link.addressable) {
      if (uri) {
        return [link, undefined, `${subaddr}/${uri}`]
      }
      return [link, undefined, subaddr]
    }
    return [link, subaddr, uri]
  }
*/
  transactionLink (link, subaddr = '', msg, timeout=600) {
    if (typeof link !== 'object') {
      return Promise.reject(new Error('500 no such link'))
    }

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
      console.log('wrong message')
    }

    /* let sent = */ link.send(subaddr, msg)
    if (subaddr) subaddr = `#${subaddr}`
    const key = `${link.linkname}${subaddr}:${(typeof msg[1] === 'number') ? msg[1] : ''}`

    /* const timerId = setTimeout((tkey) => {
      const prom = that.transactions.get(tkey); that.transactions.delete(tkey)
      if (typeof prom.err === 'function') {
        prom.err(504, 'timeout')
      }
    }, 200, key) */
    let promise = new Promise((resolve, reject) => {
      const timerId = setTimeout((tkey) => {
        // const prom = that.transactions.get(tkey)
        that.transactions.delete(tkey)
        reject(new Error('504 timeout'))
        /*        if (typeof prom.err === 'function') {
          prom.err(504, 'timeout')
        } */
      }, timeout, key)
      that.transactions.set(key, { resolve, reject, timeout: timerId, msg })
    })
    //    that.transactions.set(key, { promise, timeout: timerId, msg })
    //    that.transactions.set(key, { done, err, timeout: timerId, msg })
    // await sent ???
    return promise
  }

  transaction (addr, msg, timeout=600) {
    if (!addr) {
      if (this.links.length === 1){
        let lnk = this.links.values().next().value
        return this.transactionLink(lnk, subaddr, msg,timeout)
      }
      return Promise.reject(new Error('wrong address'))
    }
    const [linkname, subaddr = ''] = addr.split('#', 2)
    const link = this.links.get(linkname)

    return this.transactionLink(link, subaddr, msg,timeout)
  }

  _resubscribe(link, subaddr) {
    const that =this
    //    return this.transactionLink(link, subaddr, [0,0,'']).then(()=>{
    const rets=[]
    that.eventNames().forEach((topicName)=>{
      if (typeof topicName === 'string' && topicName !== 'newListener' && topicName !== 'removeListener'){
        rets.push(that.transactionLink(link, subaddr, [16, 0, topicName]) )
      }

    })
    return Promise.all(rets).catch(()=>{
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
  // publish('speed',[12,45])
  publish (topic, msg) {
    this.links.forEach((link, key, map) => {
      const to = link.subscriptions.get(topic)
      if (to) {
        const id = this.msgid++
        link.send(to ? to.subaddr : undefined, [13, id, topic, msg])
      }
    })
  }

  // call('reset')
  // call('setspeed',[12,45])
  // call('com/4','reset')
  // call('com/4','setspeed',[12,45])
  call (addr, name, args) {
    if (typeof addr === 'object' && addr !== null) {
      args = addr.arguments
      name = addr.topic || addr.name
      addr = addr.address
    } else if (arguments.length < 3 && typeof name !== 'string') { // no address at all
      args = name
      name = addr
      addr = undefined
    }
    const msg = [8, 0, name, args]
    return this.transaction(addr, msg)
  }

  // subscribe('topic')
  // subscribe('topic', (msg)=>{} )
  // subscribe('topic', {retain:'dead'} )
  // subscribe('topic', {retain:'dead'}, (msg)=>{} )
  // subscribe('address', 'topic')  subscribe for topic from specific link
  // subscribe('address', 'topic', (msg)=>{})
  // subscribe('address', 'topic', {retain:'dead'})
  // subscribe('address', 'topic', {retain:'dead'}, (msg)=>{})
  _subscribe (addr, topicName, params, onevent) {
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
    this.links.forEach((lnk)=>{
      if (lnk.ready)
        rets.push(this.transactionLink(lnk,undefined,msg) )
    })
    if (rets.length > 0) {
      return Promise.all(rets).catch(()=>{
        console.log('subscribe error')
      })
    } else {
      return Promise.resolve()
    }
    //}
  }

  // unsubscribe('topic')
  // unsubscribe('address', 'topic')  unsubscribe from topic from specific link
  _unsubscribe (addr, topicName) {
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
    this.links.forEach((lnk)=>{
      if (lnk.ready)
        rets.push(this.transactionLink(lnk,undefined,msg) )
    })
    if (rets.length > 0) {
      return Promise.all(rets).catch(()=>{
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
  describe (addr, topic) {
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

  describe (addr, name) {
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
  queueSize (addr) {
    let subaddr = ''
    let linkname = ''
    if (typeof addr === 'string') {
      const addrparts = addr.split('/', 2)
      if (Array.isArray(addrparts)) {
        linkname = addrparts[0]
        subaddr = addrparts[1]
      } else {
        linkname = addr
      }
    }
    const link = this.links.get(linkname)
    if (typeof link !== 'object') {
      return -1
    }

    return link.queueSize(subaddr)
  }

  connect (urls, opts){
    opts = Object.assign({},defaultConnectOptions,opts)
    if (typeof urls === 'string') urls = [urls]
    for (let index in urls) {
      let url = urls[index]
      if (typeof url === 'string') {
        let urlparts = url.split('://',2)
        let linkref = knownschemas[urlparts[0]]
        if (linkref) {
          let Link = require(linkref)
          let link = new Link(index, url, opts)
          this.addLink(link)
          link.connect()
        } else if (url.startsWith('ws://')) {
          let Link = require('./itmplinkws')
          let link = new Link(index, url, opts)
          this.addLink(link)
          link.connect()
        } else if (url.startsWith('serial://')) {
          let Link = require('./itmplinkserial')
          let link = new Link(index, url, opts)
          this.addLink(link)
          link.connect()
        }
      }
    }
    return this
  }

  listen (urls, opts) {
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

module.exports = itmpClient
