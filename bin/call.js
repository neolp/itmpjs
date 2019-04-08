#!/usr/bin/env node

'use strict'

// call -l "serial://COM3?baudRate=115200" -a 5 stat [34,34,34]

var ITMP = require('../')
var minimist = require('minimist')

async function send(args) {
  var client = new ITMP()
  var link = client.connect(args.link)
  console.log('connect')
  client.on(client.$connected, function () {
    console.log('connected')
    if (args.parameters) args.parameters = JSON.parse(args.parameters)
    if (!args.parameters) args.parameters = []
    client.call(link + '#' + args.address, args.topic, args.parameters, []).then((err) => { //args.parameters
      console.log(JSON.stringify(err))
      client.deleteConnection(link)
      //client.end()
    }).catch((err) => {
      console.warn(err)
      client.deleteConnection(link)
    })
  })
  client.on(client.$error, function (err) {
    console.warn(err)
    client.deleteConnection(link)
  })
}

// call -l "serial://COM3?baudRate=115200" -a 5 stat [34,34,34]
function start(args) {
  args = minimist(args, {
    string: ['link', 'username', 'password', 'address', 'parameters'],
    boolean: ['help'],
    alias: {
      link: 'l',
      topic: 't',
      parameters: 'p',
      address: 'a',
      username: 'u',
      password: 'P',
      help: 'H'
    },
    default: {
      topic: '',
      parameters: ''
    }
  })

  if (args.help) {
    return console.log('call')
  }

  args.topic = (args.topic || args._.shift()).toString()
  args.parameters = (args.parameters || args._.shift()).toString()

  if (!args.topic) {
    console.error('missing topic\n')
    return
  }

  send(args)
}

module.exports = start

if (require.main === module) {
  start(process.argv.slice(2))
}
