const EventEmitter = require('events')

class ITMP extends EventEmitter {
  constructor (_model) {
    super()
    this.links = new Map() // handle all links
    this.model = _model // link to the main model
    this.msgid = 0 // msg number incremental for transction sequencing
    this.transactions = new Map()
  }

  addLink (lnk) {
    const linkname = lnk.linkname
    this.links.set(linkname, lnk)
  }

  deleteConnection (name) {
    let link = this.links.get(name)
    if (this.model) {
      this.model.disconnect(link)
    }
    link.subscriptions.forEach((val, uri, map) => {
      if (val.unsubscribe) {
        val.unsubscribe(uri, null, val)
      }
    })
    link.subscriptions.clear()
    this.links.delete(name)
  }

  processConnect (link, addr, id, payload) {
    let [uri, opts] = payload
    if (opts === undefined || typeof opts !== 'object') opts = {}
    let ret
    if (this.model) {
      ret = this.model.connect(link, addr, uri, opts)
    }
    if (ret !== undefined) {
      this.answer(addr, [1, id, 'ok', ret.ret])
    } else {
      this.answer(addr, [1, id, 'ok'])
    }
  }

  processConnected2 (key, payload) {
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
      console.log('unexpected error', payload)
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
    this.model.call(uri,args,opts).
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
    const [topic, args, ots] = payload
    this.model.processIncomeEvent(link.connected ? `${link.connected.link}/${topic}` : `${addr}/${topic}`, args, ots)
  }

  processSubscribe (link, addr, id, payload) {
    const [originaluri, opts] = payload
    let uri
    if (link.connected) {
      console.log('linked subscribe', addr, ' for ', originaluri)
      uri = `area${link.connected.link}/${originaluri}`
    } else {
      uri = originaluri
    }
    console.log('subscribe', addr, ' for ', uri)

    if (!link.subscriptions.has(originaluri)) {
      const s = { link, addr, emit:this.emitEvent.bind(this) }
      const ret = this.model.subscribe(uri, opts, s)
      if (ret === undefined) {
        console.log(`fault subs${JSON.stringify(payload)}`)
        this.answer(addr, [5, id, 404, 'no such uri'])
      } else {
        this.answer(addr, [17, id, ret])
        link.subscriptions.set(originaluri, s)
      }
    } else {
      this.answer(addr, [5, id, 500, 'already subscribed'])
    }
  }
  processUnsubscribe (link, addr, id, payload) {
    const [uri, opts] = payload
    console.log('unsubscribe', addr, ' at ', uri)
    const s = link.subscriptions.get(uri)
    if (s !== undefined) {
      let ret
      if (s.unsubscribe) {
        ret = s.unsubscribe(uri, opts, s)
      }
      link.subscriptions.delete(uri)
      this.answer(addr, [19, id, ret])
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

  processSubscribed (addr, key, id, payload) {
    const t = this.transactions.get(key)
    if (t !== undefined) {
      this.transactions.delete(key)
      clearTimeout(t.timeout)
      t.resolve(payload)
    } else {
      console.log('unexpected result', payload)
    }
  }

  processUnsubscribed (key, payload) {
    const t = this.transactions.get(key)
    if (t !== undefined) {
      clearTimeout(t.timeout)
      this.transactions.delete(key)
      const [, opts] = payload // id, opts
      t.resolve(opts)
    } else {
      console.log('unexpected result', payload)
    }
  }

  process (link, addr, msg) {
    if (typeof addr === 'undefined' || (typeof addr === 'string' && addr.length === 0)) {
      addr = link.linkname
    } else {
      // addr = `${link.linkname}/${addr}`
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
          this.processSubscribed(addr, key, id, payload)
          break
        case 18: // [UNSUBSCRIBE, Request:id, Topic:uri, Options:dict]
          this.processUnsubscribe(link, addr, id, payload)
          break
        case 20: // [UNSUBSCRIBED, UNSUBSCRIBE.Request:id, Options:dict]
          this.processUnsubscribed()
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

  getLink (addr) {
    const [linkname, subaddr, uri] = addr.split('/', 3)
    const link = this.links.get(linkname)
    if (!link || !link.addressable) {
      if (uri) {
        return [link, undefined, `${subaddr}/${uri}`]
      }
      return [link, undefined, subaddr]
    }
    return [link, subaddr, uri]
  }

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
    }

    /* let sent = */ link.send(subaddr, msg)
    if (subaddr) subaddr = `/${subaddr}`
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
    if (addr === undefined) return Promise.reject(new Error('wrong address'))
    const [linkname, subaddr = ''] = addr.split('/', 2)
    const link = this.links.get(linkname)

    return this.transactionLink(link, subaddr, msg,timeout)
  }

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

  call (addr, name, param) {
    const msg = [8, 0, name, param]
    return this.transaction(addr, msg)
  }

  subscribe (addr, name, param) {
    const msg = [16, 0, name, param]
    return this.transaction(addr, msg)
  }

  unsubscribe (addr, name, param) {
    const msg = [18, 0, name, param]
    return this.transaction(addr, msg)
  }

  connect (addr, name, param) {
    const msg = [0, 0, name, param]
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
}

module.exports = ITMP
