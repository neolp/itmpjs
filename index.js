/* eslint-disable no-console */
const EventEmitter = require('events')
const npmpackegeversion = require('./package.json').version

const defaultConnectOptions = {
  keepalive: 60,
  protocolId: 'ws',
  reconnectPeriod: 1000,
  connectTimeout: 30 * 1000,
  resubscribe: true
}
const defaultServerOptions = {
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
  ws: 'itmplinkws',
  serial: 'itmplinkserial'
}

class itmpClient extends EventEmitter {
  constructor(link, opts = {}) {
    super()
    this.link = link // handle link
    this.url = link.name

    this.msgid = 0 // msg number incremental for transction sequencing
    this.transactions = new Map() // handle unfinished transactions
    this.remotesubscriptions = new Map()

    this.callhandlers = new Map()

    this.resubscribe = opts.resubscribe !== undefined ? opts.resubscribe : true

    this.role = opts.role ? opts.role : 'client' // role determine who send first message for login client send first message, server wait for message, node connects without login
    this.realm = opts.realm ? opts.realm : 'itmp client' // realm describes what is it, it can de user, robot, proxy, .... - main function
    this.token = opts.token ? opts.token : ''
    this.name = opts.name ? opts.name : ''
    this.uid = opts.uid ? opts.uid : Math.random().toString(36).substring(7)
    this.loginState = 0 // 0 - waiting for login
    this.nonce = Math.random().toString(36).substring(7)

    this.on('newListener', (eventName) => { // when subscribe new listener (it is from 'events' interface)
      if (eventName === undefined) throw (new Error('wrong event name: undefined'))
      if (typeof eventName === 'string' && eventName !== 'newListener' && eventName !== 'removeListener' && this.listenerCount(eventName) === 0) {
        if (this.loginState > 1)
          this._subscribe(eventName, undefined, 2000).catch((err) => {
            console.log('external subscribe error', err)
          })
      }
    })
    this.on('removeListener', (eventName) => { // when unsubscribe the listener (it is from 'events' interface)
      if (typeof eventName === 'string' && eventName !== 'newListener' && eventName !== 'removeListener' && this.listenerCount(eventName) === 0) {
        if (this.loginState > 1)
          this._unsubscribe(eventName)
      }
    })

    link.on('connect', () => { // then link connected (become active) send initial CONNECT message and then got answer make link connected
      if (this.role === 'client') { // we need to login // send authentification data
        this.transaction([0, 0, this.realm, { uid: this.uid, name: this.name, nonce: this.nonce, token: this.token, var: npmpackegeversion }], 3000).then(([rrealm, ropts]) => {
          if (ropts === undefined || typeof ropts !== 'object') ropts = {}
          let event = Object.assign({}, ropts, { rrealm, name: link.name, block: false })
          this.emit(this.$loggedin, event)
          if (event.block) {
            console.log('got connect BLOCK => Stopeed', event)
            this.close()
            this.loginState = 0 // NOT connected
            this.emit(this.$disconnected, link.name)
          } else {
            console.log('got connect restore subscriptions')
            this.loginState = 2 // connected
            this.emit(this.$connected, event)
            this._resubscribe()
          }
        }).catch((err) => {
          console.log('login rejected ', err)
          this.close()
          this.loginState = 0 // NOT connected
          this.emit(this.$disconnected, link.name)
        })
      } else if (this.role === 'server') {
        console.log('server connect')
        this.loginState = 1 // Semi connected
        // do nothing but no one can send message until login
      } else { //allow connection without login
        this.loginState = 3 // connected without login
      }
    })
    link.on('disconnect', () => { // then link disconnected unsubscribe all topics from thet link
      this.remotesubscriptions.forEach((val, uri) => {
        if (val.unsubscribe) {
          val.unsubscribe(uri, null, val)
        }
        this.emit(this.$unsubscribe, uri, val.addr)
      })
      this.remotesubscriptions.clear()
      this.loginState = 0 // NOT connected
      this.emit(this.$disconnected)
    })
    link.on('message', (msg) => {
      //      console.log('income message',JSON.stringify(msg))
      this.process(msg)
    })
  }
/**
 * Set call handler for given topic
 * @param {string} topic call name
 * @param {Function} func async function than handle request with given topic
 * @param {string} desc description returned with desc request
 */
  oncall(topic, func, desc) {
    if (this.callhandlers.has(topic)) throw (new Error('call handler for existing call'))
    if (func.constructor.name !== 'AsyncFunction') throw (new Error('call handler must be async function'))
    this.callhandlers.set(topic, { topic, func, desc })
  }
  /**
   * Remove call handler
   * @param {string} topic 
   */
  offcall(topic) {
    if (!this.callhandlers.has(topic)) throw (new Error('call handler not exist'))
    this.callhandlers.delete(topic)
  }
  /**
   * set call handler for all unknown topcs (except known with onclall() method)
   * @param {function} call
   */
  setGeneralCall(call) {
    this.gencall = call
  }

  stop() {
    // remove incoming subscriptions
    this.remotesubscriptions.forEach((val, uri) => {
      if (val.unsubscribe) {
        val.unsubscribe(uri, null, val)
      }
      this.emit(this.$unsubscribe, uri, val)
    })
    this.remotesubscriptions.clear()
    this.link.removeAllListeners('connect')
    this.link.removeAllListeners('disconnect')
    this.link.removeAllListeners('message')
    this.link.stop()
    //    this.link = null //??
  }

  close() {
    // remove incoming subscriptions
    this.remotesubscriptions.forEach((val, uri) => {
      if (val.unsubscribe) {
        val.unsubscribe(uri, null, val)
      }
      this.emit(this.$unsubscribe, uri, val)
    })
    this.remotesubscriptions.clear()
    this.link.close()
  }

  processConnect(id, payload) { // remote end wants to login to us
    let [rrealm, ropts] = payload
    if (ropts === undefined || typeof ropts !== 'object') ropts = {}
    let event = Object.assign({}, ropts, { rrealm, block: false })
    this.emit(this.$login, event)
    if (event.block) {
      console.log('got connect BLOCK', JSON.stringify(event))
      this.answer([5, id, event.blockcode ? event.blockcode : 403, event.blockreason ? event.blockreason : 'forbidden'])
      this.loginState = 0 // NOT connected
      this.close()
    } else {
      console.log('got connect restore subscriptions')
      this.loginState = 2 // connected
      this.answer([1, id, this.realm, { uid: this.uid, nonce: this.nonce, name: this.name, token: this.token, var: npmpackegeversion }])
      this.emit(this.$connected, event)
      this._resubscribe()
    }
  }

  processConnected(key, payload) {
    // this.processConnect()
    const t = this.transactions.get(key)
    if (t !== undefined) {
      clearTimeout(t.timeout)
      this.transactions.delete(key)
      const [realm, opts] = payload
      t.resolve([realm, opts])
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

  processCall(id, payload) {
    const [uri, args, opts] = payload

    if (this.callhandlers.has(uri)) {
      let record = this.callhandlers.get(uri)
      record.func(uri, args, opts).
        then((ret) => {
          this.answer([9, id, ret])
        }).
        catch((err) => {
          if (err.code) {
            this.answer([5, id, err.code, err.message])
          } else {
            this.answer([5, id, 500, 'internal error'])
          }
        })
    } else if (this.gencall) {
      this.gencall(uri, args, opts).
        then((ret) => {
          this.answer([9, id, ret])
        }).
        catch((err) => {
          if (err.code) {
            this.answer([5, id, err.code, err.message])
          } else {
            this.answer([5, id, 500, 'internal error'])
          }
        })
    } else {
      this.answer([5, id, 404, 'no such call'])
    }
  }

  finishtransaction(key) {
    const t = this.transactions.get(key)
    if (t !== undefined) {
      clearTimeout(t.timeout)
      this.transactions.delete(key)
    }
    return t
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

  processEvent(payload) {
    // console.log("event",msg);
    const [topicName, args, opts] = payload
    // let node = this.localsubscriptions.get(topicName)
    // if (node && node.onMessage) {
    //   node.lastMessage = { topic: topicName, args, opts, link: this }
    //   node.onMessage(topicName, args, opts)
    // }
    this.emit(this.$message, this, topicName, args, opts)
    this.emit(topicName, args, opts)
    //this.model.processIncomeEvent(link.connected ? `${link.connected.link}/${topic}` : `${addr}/${topic}`, args, ots)
  }

  processPublish(id, payload) {
    // console.log("event",msg);
    const [topicName, args, opts] = payload
    // let node = this.localsubscriptions.get(topicName)
    // if (node && node.onMessage) {
    //   node.lastMessage = { topic: topicName, args, opts, link: this }
    //   node.onMessage(topicName, args, opts)
    // }
    this.emit(this.$message, this, topicName, args, opts)
    this.emit(topicName, args, opts)
    this.answer([15, id])
  }

  processSubscribe(id, payload) {
    const [originaluri, opts] = payload
    //let uri
    //    if (link.connected) {
    //console.log('linked subscribe', addr, ' for ', originaluri)
    //      uri = `area${link.connected.link}/${originaluri}`
    //    } else {
    //uri = originaluri
    //    }
    //console.log('subscribe', addr, ' for ', uri)

    if (!this.remotesubscriptions.has(originaluri)) {
      const s = {}
      //const ret = this.model.subscribe(uri, opts, s)
      //if (ret === undefined) {
      //console.log(`fault subs${JSON.stringify(payload)}`)
      //this.answer(addr, [5, id, 404, 'no such uri'])
      //} else {
      if (typeof originaluri === 'string' && originaluri.length > 0) {
        this.remotesubscriptions.set(originaluri, s)
        try {
          this.emit(this.$subscribe, originaluri, opts)
          this.answer([17, id])
        } catch (err) {
          this.answer([5, id, 500, err.message])
        }
      } else {
        this.answer([5, id, 400, 'wrong topic'])
      }

      //}
    } else {
      this.answer([5, id, 409, errors[409]])
    }
  }
  processUnsubscribe(id, payload) {
    const [uri, opts] = payload
    //console.log('unsubscribe', addr, ' at ', uri)
    const s = this.remotesubscriptions.get(uri)
    if (s !== undefined) {
      let ret
      if (s.unsubscribe) {
        ret = s.unsubscribe(uri, opts, s)
      }
      this.remotesubscriptions.delete(uri)
      this.answer([19, id, ret])
      this.emit(this.$unsubscribe, uri, opts)
    } else {
      console.log(`unexpected unsubs${JSON.stringify(payload)}`)
      this.answer([5, id, 404, 'no such uri'])
    }
  }

  processDescribe(id, payload) {
    const [uri, , opts] = payload
    let ret = this.model.describe(uri, opts)
    if (ret !== undefined) {
      this.answer([7, id, ret])
    } else {
      console.log(`unexpected descr${JSON.stringify(payload)}`)
      this.answer([5, id, 404, 'no such uri'])
    }
  }

  processSubscribed(key, payload) {
    const t = this.transactions.get(key)
    if (t !== undefined) {
      this.transactions.delete(key)
      clearTimeout(t.timeout)
      t.resolve(payload)
    } else {
      console.log('unexpected subscribed', key, payload)
    }
  }

  processUnsubscribed(key, payload) {
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

  process(msg) {
    //      addr = link.linkname
    //      addr = `${link.linkname}#${addr}`
    if (Array.isArray(msg) && msg.length >= 1 && typeof msg[0] === 'number') {
      let [command, ...payload] = msg
      let id;
      [id, ...payload] = payload

      if (this.loginState < 2 && command > 5) {// NOT connected
        this.answer([5, id, 403, 'forbidden before login'])
        return
      }

      switch (command) {
        case 0: // [CONNECT, Connection:id, Realm:uri, Details:dict] open connection
          this.processConnect(id, payload)
          break
        case 1: // [CONNECTED, CONNECT.Connection:id, Session:id, Details:dict] confirm connection
          this.processConnected(id, payload)
          break
        case 2: // [ABORT, Code:integer, Reason:string, Details:dict] terminate connection
        case 4: // [DISCONNECT, Code:integer, Reason:string, Details:dict] clear finish connection
        case 5: // [ERROR, Request:id, Code:integer, Reason:string, Details:dict] error notificarion
          this.processError(id, payload)
          break
        case 6: // [DESCRIBE, Request:id, Topic:uri, Options:dict] get description
          this.processDescribe(id, payload)
          break
        case 7: // [DESCRIPTION, DESCRIBE.Request:id, description:list, Options:dict] response
          this.processResult(id, payload)
          break
        // RPC -----------------------------
        case 8: // [CALL, Request:id, Procedure:uri, Arguments, Options:dict] call
          this.processCall(id, payload)
          break
        case 9: // [RESULT, CALL.Request:id, Result, Details:dict] call response
          this.processResult(id, payload)
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
          this.processEvent(payload)
          break
        case 14: // [PUBLISH, Request:id, Topic:uri, Arguments, Options:dict] event with acknowledge
          this.processPublish(id, payload)
          //console.log('publish', msg)
          break
        case 15: // [PUBLISHED, PUBLISH.Request:id, Publication:id, Options:dict] event acknowledged
          //console.log('published', msg)
          this.processResult(id, payload)
          break
        // subscribe
        case 16: // [SUBSCRIBE, Request:id, Topic:uri, Options:dict] subscribe
          this.processSubscribe(id, payload)
          break
        case 17: // [SUBSCRIBED, SUBSCRIBE.Request:id, Options:dict] subscription confirmed
          this.processSubscribed(id, payload)
          break
        case 18: // [UNSUBSCRIBE, Request:id, Topic:uri, Options:dict]
          this.processUnsubscribe(id, payload)
          break
        case 19: // [UNSUBSCRIBED, UNSUBSCRIBE.Request:id, Options:dict]
          this.processUnsubscribed(id, payload)
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

  answer(msg) {
    this.link.send(msg)
  }

  transaction(msg, timeout = 600) {
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

    const key = msg[1]
    /* let sent = */ this.link.send(msg).catch((err) => {
      let t = this.finishtransaction(key)
      if (t) t.reject(new Error(err))
    })

    return new Promise((resolve, reject) => {
      const timerId = setTimeout((tkey) => {
        that.transactions.delete(tkey)
        reject(new Error('504 timeout'))
      }, timeout, key)
      that.transactions.set(key, { resolve, reject, timeout: timerId, msg })
    })
  }

  _resubscribe() {
    if (!this.resubscribe) return Promise.resolve()
    const that = this
    const rets = []
    that.eventNames().forEach((topicName) => {
      if (typeof topicName === 'string' && topicName !== 'newListener' && topicName !== 'removeListener') {
        rets.push(that.transaction([16, 0, topicName]).then(() => {
          console.log('resubscribed', topicName)
        }).catch(() => {
          console.log('failed resubscribed', topicName)
        }))
      }

    })
    return Promise.all(rets).catch(() => {
      console.log('subscribe error')
    })
    //    })
  }

  // publish('reset')
  // publish('setspeed',[12,45])
  publish(topic, message, opts) {
    if (opts) return this.transaction([14, 0, topic, message, opts]) // 14 - publish message, 15 - published message
    return this.transaction([14, 0, topic, message])
  }

  // sendEvent('reset',[12,45])
  sendEvent(topic, message, opts) {
    const id = this.msgid++
    if (opts) return this.link.send([13, id, topic, message, opts])
    return this.link.send([13, id, topic, message])
  }

  // call('reset')
  // call('setspeed',[12,45])
  call(name, args, opts, timeout) {
    if (opts) return this.transaction([8, 0, name, args, opts])
    return this.transaction([8, 0, name, args], timeout)
  }

  // subscribe('topic')
  // subscribe('topic', {retain:'dead'} )
  // subscribe('topic', {retain:'dead'} )
  _subscribe(topicName, params, timeout) {
    const msg = [16, 0, topicName, params]
    return this.transaction(msg, timeout)
  }

  // unsubscribe('topic')
  _unsubscribe(topicName) {
    const msg = [18, 0, topicName]
    return this.transaction(msg)
  }

  // describe('topic')
  // describe('address', 'topic')
  describe(topic) {
    const msg = [6, 0, topic]
    return this.transaction(msg)
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
}

itmpClient.prototype.$login = Symbol('login') // event fired when remote peer wants to login to us with connect parameters (event = {uri,opts,block:false})
itmpClient.prototype.$loggedin = Symbol('loggedin') // event fired when both end was agree to be logged in (event = {uri,opts})
itmpClient.prototype.$connected = Symbol('connected') // event fired wthen client fully connected (and resubscription was finished)
itmpClient.prototype.$disconnected = Symbol('disconnected') // event fired when client was disconnected
itmpClient.prototype.$subscribe = Symbol('subscribe') //  event fired when client subscribe for topic
itmpClient.prototype.$unsubscribe = Symbol('unsubscribe') //  event fired when client unsubscribe for topic
itmpClient.prototype.$message = Symbol('message')  //  event fired when client send an event
itmpClient.prototype.$error = Symbol('error')  //  event fired when client error


// urls
// itmp:ws://localhost:1884/ws
// itmp:serial:///dev/usbtty0?
// itmp:serial://COM9?baudRate=115200
// itmp:serial://COM3?baudRate=115200~8
// itmp:wssrv:///ws    expressapp: app
// itmp:com~8


function connect(url, opts) {
  if (url.startsWith('itmp://')) url = url.substring(7)
  else if (url.startsWith('itmp:')) url = url.substring(5)
  else if (url.startsWith('itmp.')) url = url.substring(5)
  opts = Object.assign({}, defaultConnectOptions, opts)
  let urlparts = url.split('://', 2)
  let linkref = knownschemas[urlparts[0]]
  if (linkref) {
    let Link = require(linkref)
    let link = new Link(url, opts)
    let con = new itmpClient(link, opts)
    link.connect()
    return con
  }
  return undefined
}

const Servers = new Map() // handle all listeners for incoming connection

function createServer(url, opts, callback) {
  if (url.startsWith('itmp://')) url = url.substring(7)
  else if (url.startsWith('itmp:')) url = url.substring(5)
  else if (url.startsWith('itmp.')) url = url.substring(5)
  opts = Object.assign({}, defaultServerOptions, opts)
  if (url.startsWith('ws://')) {
    let Srv = require('itmplinkserverws')
    opts.role = 'server'
    let srv = new Srv(url, opts, (link) => {
      let con = new itmpClient(link, opts)
      con.once(con.$disconnected, () => {
        //con.removeAllListeners(con.$disconnected)
      })
      callback(con)
    })
    Servers.set(srv.listenername, srv)
    return srv
  }
  return undefined
}

module.exports = { createServer: createServer, connect: connect }
