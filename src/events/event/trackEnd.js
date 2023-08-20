import utils from '../../utils.js'

function trackEnd(Event, payload, node, config, Nodes, Players) {
  if (config.debug) console.log(`[FastLink] ${node} has ended a track`)

  let player = Players[payload.guildId]

  if (!player) return console.log(`[FastLink] Received TrackEndEvent from ${node} but no player was found`)

  if (config.queue && payload.reason != 'replaced') {
    player.queue.shift()

    if (player.queue.length > 0) {
      utils.makeRequest(`http${Nodes[node].secure ? 's' : ''}://${Nodes[node].hostname}/v4/sessions/${Nodes[node].sessionId}/players/${payload.guildId}`, {
        headers: {
          Authorization: Nodes[node].password
        },
        body: {
          encodedTrack: player.queue[0]
        },
        port: Nodes[node].port,
        method: 'PATCH'
      })

      return Players
    }
  } else player.track = null

  player.playing = false
  player.volume = null

  Event.emit('trackEnd', { node: Nodes[node], guildId: payload.guildId, player, track: payload.track  })

  return Players
}

export default trackEnd