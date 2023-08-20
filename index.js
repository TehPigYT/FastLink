/**
 * @file index.js
 * @author PerformanC <performancorg@gmail.com>
 */

import event from 'events'

import events from './src/events.js'
import utils from './src/utils.js'
import Pws from './src/ws.js'

let Config = {}
let Nodes = {}
let Players = {}
let sessionIds = {}

const Event = new event()

/**
 * Connects node's WebSocket server for communication.
 *
 * @param {Array} An array of node objects containing connection details.
 * @param {Object} Configuration object containing botId, shards, queue, and debug options.
 * @throws {Error} If nodes or config is not provided or not in the expected format.
 * @returns {Object} Event object representing the WebSocket event handlers.
 */
function connectNodes(nodes, config) {
  if (!nodes) throw new Error('No nodes provided.')
  if (typeof nodes != 'object') throw new Error('Nodes must be an array.')

  if (!config) throw new Error('No config provided.')
  if (typeof config != 'object') throw new Error('Config must be an object.')

  if (config.debug == undefined) throw new Error('No debug provided.')
  if (typeof config.debug != 'boolean') throw new Error('Debug must be a boolean.')

  if (!config.botId) throw new Error('No botId provided.')
  if (typeof config.botId != 'string') throw new Error('BotId must be a string.')

  if (!config.shards) throw new Error('No shards provided.')
  if (typeof config.shards != 'number') throw new Error('Shards must be a number.')

  if (config.queue && typeof config.queue != 'boolean') throw new Error('Queue must be a boolean.')

  Config = {
    botId: config.botId,
    shards: config.shards,
    queue: config.queue || false,
    debug: config.debug || false
  }

  nodes.forEach((node) => {
    if (!node.hostname) throw new Error('No hostname provided.')
    if (typeof node.hostname != 'string') throw new Error('Hostname must be a string.')

    if (!node.password) throw new Error('No password provided.')
    if (typeof node.password != 'string') throw new Error('Password must be a string.')

    if (typeof node.secure != 'boolean') throw new Error('Secure must be a boolean.')

    if (!node.port) node.port = 2333

    Nodes[node.hostname] = {
      ...node,
      connected: false,
      sessionId: null
    }

    let ws = new Pws(`ws${node.secure ? 's' : ''}://${node.hostname}:${node.port}/v4/websocket`, {
      headers: {
        Authorization: node.password,
        'Num-Shards': config.shards,
        'User-Id': config.botId,
        'Client-Name': 'FastLink'
      }
    })

    ws.on('open', () => Nodes = events.open(node.hostname, Config, Nodes))

    ws.on('message', (data) => {
      const temp = events.message(Event, data, node.hostname, Config, Nodes, Players)

      Nodes = temp.Nodes
      Players = temp.Players
    })

    ws.on('close', () => {
      const temp = events.close(ws, node, Config, Nodes, Players)

      Nodes = temp.Nodes
      Players = temp.Players
      ws = temp.ws
    })

    ws.on('error', (err) => Nodes = events.error(err, node.hostname, Config, Nodes))
  })

  return Event
}

/**
 * Checks if any node is connected.
 *
 * @returns {boolean} The boolean if any node is connected or not.
 */
function anyNodeAvailable() {
  return Object.values(Nodes).filter((node) => node?.connected).length == 0 ? false : true
}

function getRecommendedNode() {
  const nodes = Object.values(Nodes).filter((node) => node?.connected)

  if (nodes.length == 0) throw new Error('No node connected.')
  
  return nodes.sort((a, b) => (a.stats.systemLoad / a.stats.cores) * 100 - (b.stats.systemLoad / b.stats.cores) * 100)[0]
}

/**
 * Represents a player for an audio streaming service.
 *
 * @class Player
 */
class Player {
  /**
   * Constructs a Player object.
   *
   * @param {string} The ID of the guild that will be associated with the player.
   * @throws {Error} If the guildId is not provided, or if they are of invalid type.
   */
  constructor(guildId) {  
    if (!guildId) throw new Error('No guildId provided.')
    if (typeof guildId != 'string') throw new Error('GuildId must be a string.')

    this.guildId = guildId
    this.node = Players[this.guildId]?.node
  }

  /**
   * Creates a player for the specified guildId.
   *
   * @param {string} The ID of the guild for which the player is being created.
   * @throws {Error} If guildId is not provided or not a string.
   * @returns {string} The hostname of the recommended node for the player.
   */
  createPlayer() {
    if (Players[this.guildId])
      throw new Error('Player already exists. Use playerCreated() to check if a player exists.')

    const node = getRecommendedNode().hostname

    Players[this.guildId] = {
      connected: false,
      playing: false,
      paused: false,
      volume: null,
      node
    }

    if (Config.queue) Players[this.guildId].queue = []
    else Players[this.guildId].track = null

    this.node = node
  }

  /**
   * Verifies if a player exists for the specified guildId.
   * 
   * @param {string} The ID of the guild for which the player is being retrieved.
   * @returns {boolean} The boolean if the player exists or not.
   */
  playerCreated() {
    return Players[this.guildId] ? true : false
  }

  /**
   * Connects to a voice channel.
   *
   * @param {string} The ID of the voice channel to connect to.
   * @param {Object} Options for the connection, deaf or mute.
   * @param {Function} A function for sending payload data.
   * @throws {Error} If the voiceId or sendPayload is not provided, or if they are of invalid type.
   */
  connect(voiceId, options, sendPayload) {  
    if (!voiceId) throw new Error('No voiceId provided.')
    if (typeof voiceId != 'string') throw new Error('VoiceId must be a string.')

    if (!options) options = {}
    if (typeof options != 'object') throw new Error('Options must be an object.')

    if (!sendPayload) throw new Error('No sendPayload provided.')
    if (typeof sendPayload != 'function') throw new Error('SendPayload must be a function.')

    Players[this.guildId].connected = !!voiceId
  
    sendPayload(this.guildId, {
      op: 4,
      d: {
        guild_id: this.guildId,
        channel_id: voiceId,
        self_mute: options.mute || false,
        self_deaf: options.deaf || false
      }
    })
  }

  /**
   * Loads a track.
   *
   * @param {string} The search query for the track.
   * @return {TrackData} The loaded track data.
   * @throws {Error} If the search is not provided or is of invalid type.
   */
  async loadTrack(search) {  
    if (!search) throw new Error('No search provided.')
    if (typeof search != 'string') throw new Error('Search must be a string.')
  
    const data = await this.makeRequest(`/loadtracks?identifier=${encodeURIComponent(search)}`, {
      method: 'GET'
    })
  
    return data
  }

  /**
   * Retrieves the captions for a given track. NodeLink exclusive.
   * 
   * @param {string} The track to retrieve captions for.
   * @throws {Error} If the track is not provided or is of invalid type.
   * @return {Promise} A Promise that resolves to the retrieved captions data.
   */
  async getCaptions(track) {
    if (!track) throw new Error('No track provided.')
    if (typeof track != 'string') throw new Error('Track must be a string.')

    const data = await this.makeRequest(`/loadcaptions?encodedTrack=${encodeURIComponent(track)}`, {
      method: 'GET'
    })

    return data
  }

  /**
   * Updates the player state.
   *
   * @param {Object} body The body of the update request.
   * @param {boolean} Optional flag to specify whether to replace the existing track or not.
   * @throws {Error} If the body is not provided or is of invalid type.
   */
  async update(body, noReplace) {  
    if (!body) throw new Error('No body provided.')
    if (typeof body != 'object') throw new Error('Body must be an object.')
  
    if (body.encodedTrack && Config.queue) {
      Players[this.guildId].queue.push(body.encodedTrack)

      if (Players[this.guildId].queue.length != 1) return;
    } else if (body.encodedTrack !== undefined) Players[this.guildId].queue = []
  
    if (body.encodedTracks) {
      if (!Config.queue)
        throw new Error('Queue is disabled. (Config.queue = false)')
  
      if (Players[this.guildId].queue.length == 0) {
        Players[this.guildId].queue = body.encodedTracks
  
        this.makeRequest(`/sessions/${Nodes[this.node].sessionId}/players/${this.guildId}`, {
          body: { encodedTrack: body.encodedTracks[0] },
          method: 'PATCH'
        })
      } else body.encodedTracks.forEach((track) => Players[this.guildId].queue.push(track))
  
      return;
    }

    if (body.paused !== undefined) {
      Players[this.guildId].playing = !body.paused
      Players[this.guildId].paused = body.paused
    }
  
    const data = await this.makeRequest(`/sessions/${Nodes[this.node].sessionId}/players/${this.guildId}?noReplace=${noReplace !== true ? false : true}`, {
      body,
      method: 'PATCH'
    })

    return data
  }

  /**
   * Destroys the player.
   *
   * @throws {None}
   */
  destroy() {  
    Nodes[this.node].players[this.guildId] = null
  
    this.makeRequest(`/sessions/${Nodes[this.node].sessionId}/players/${this.guildId}`, {
      method: 'DELETE'
    })
  }

  /**
   * Updates the session data for the player.
   *
   * @param {Object} The session data to update.
   * @throws {Error} If the data is not provided or is of invalid type.
   */
  updateSession(data) {  
    if (!data) throw new Error('No data provided.')
    if (typeof data != 'object') throw new Error('Data must be an object.')
  
    this.makeRequest(`/sessions/${Nodes[this.node].sessionId}`, {
      body: data,
      method: 'PATCH'
    })
  }

  /**
   * Gets the queue of tracks.
   *
   * @return {Array<TrackData>} The queue of tracks.
   * @throws {Error} If the queue is disabled.
   */
  getQueue() {  
    if (!Config.queue) throw new Error('Queue is disabled. (Config.queue = false)')
  
    return Players[this.guildId].queue
  }

  /**
   * Skips the currently playing track.
   *
   * @return {SkipResult} The skipped track data.
   * @throws {Error} If the queue is disabled or there are no tracks in the queue.
   */
  skipTrack() {  
    if (!Config.queue) throw new Error('Queue is disabled. (Config.queue = false)')

    if (Players[this.guildId].queue.length < 1)
      return { skipped: false, queue: [], error: 'No tracks in queue.' }

    Players[this.guildId].queue.shift()
  
    this.makeRequest(`/sessions/${Nodes[this.node].sessionId}/players/${this.guildId}`, {
      body: { encodedTrack: Players[this.guildId].queue[0] },
      method: 'PATCH'
    })
  
    return { skipped: true, queue: Players[this.guildId].queue }
  }

  /**
   * Decodes a track.
   *
   * @param {string} The array to decode.
   * @throws {Error} If a track is not provided or if track is not a string.
   * @return {Promise} A Promise that resolves to the decoded data.
   */
  async decodeTrack(track) {  
    if (!track) throw new Error('No track provided.')
    if (typeof track != 'string') throw new Error('Track must be a string.')
  
    const data = await utils.makeRequest(`/decodetrack?encodedTrack=${track}`, {
      method: 'GET'
    })
  
    return data
  }
  
  /**
   * Decodes an array of tracks.
   *
   * @param {Array} The array of tracks to decode.
   * @throws {Error} If no tracks are provided or if tracks is not an array.
   * @return {Promise} A Promise that resolves to the decoded data.
   */
  async decodeTracks(tracks) {  
    if (!tracks) throw new Error('No tracks provided.')
    if (typeof tracks != 'object') throw new Error('Tracks must be an array.')
  
    const data = await this.makeRequest(`/decodetracks`, {
      body: tracks,
      method: 'POST'
    })
  
    return data
  }

  /**
   * Loads captions for a given track.
   * 
   * @param {string} The track to load captions for.
   * @param {string?} The language to load captions for.
   * @throws {Error} If the track is not provided or is of invalid type.
   * @return {Promise} A Promise that resolves to the loaded captions data.
   */
  async loadCaptions(track, lang) {  
    if (!track) throw new Error('No track provided.')
    if (typeof track != 'string') throw new Error('Track must be a string.')

    if (lang && typeof lang != 'string') throw new Error('Lang must be a string.')
  
    const data = await this.makeRequest(`/loadcaptions?encodedTrack=${track}${lang ? `&language=${lang}`: ''}`, {
      method: 'GET'
    })
  
    return data
  }

  async makeRequest(path, options) {
    const data = await utils.makeRequest(`http${Nodes[this.node].secure ? 's' : ''}://${Nodes[this.node].hostname}/v4${path}`, {
      headers: {
        Authorization: Nodes[this.node].password
      },
      body: options.body,
      port: Nodes[this.node].port,
      method: options.method
    })

    return data
  }
}

/**
 * Retrieves the players for a given node.
 *
 * @param {string} The node to retrieve players from.
 * @throws {Error} If no node is provided or if node is not a string.
 * @return {Promise} A Promise that resolves to the retrieved player data.
 */
async function getPlayers(node) {
  if (!node) throw new Error('No node provided.')
  if (typeof node != 'string') throw new Error('Node must be a string.')

  if (!Nodes[node]) throw new Error('Node does not exist.')

  const data = await utils.makeRequest(`http${Nodes[node].secure ? 's' : ''}://${Nodes[node].hostname}/v4/sessions/${Nodes[node].sessionId}/players`,{
    headers: {
      Authorization: Nodes[node].password
    },
    port: Nodes[node].port,
    method: 'GET'
  })

  return data
}

/**
 * Retrieves the info for a given node.
 *
 * @param {string} The node to retrieve info from.
 * @throws {Error} If no node is provided or if node is not a string.
 * @return {Promise} A Promise that resolves to the retrieved info data.
 */
async function getInfo(node) {
  if (!node) throw new Error('No node provided.')
  if (typeof node != 'string') throw new Error('Node must be a string.')

  if (!Nodes[node]) throw new Error('Node does not exist.')

  const data = await utils.makeRequest(`http${Nodes[node].secure ? 's' : ''}://${Nodes[node].hostname}/v4/info`, {
    headers: {
      Authorization: Nodes[node].password
    },
    port: Nodes[node].port,
    method: 'GET'
  })

  return data
}

/**
 * Retrieves the stats for a given node.
 *
 * @param {string} The node to retrieve stats from.
 * @throws {Error} If no node is provided or if node is not a string.
 * @return {Promise} A Promise that resolves to the retrieved stats data.
 */
async function getStats(node) {
  if (!node) throw new Error('No node provided.')
  if (typeof node != 'string') throw new Error('Node must be a string.')

  if (!Nodes[node]) throw new Error('Node does not exist.')

  const data = await utils.makeRequest(`http${Nodes[node].secure ? 's' : ''}://${Nodes[node].hostname}/v4/stats`, {
    headers: {
      Authorization: Nodes[node].password
    },
    port: Nodes[node].port,
    method: 'GET'
  })

  return data
}

/**
 * Retrieves the version for a given node.
 *
 * @param {string} The node to retrieve version from.
 * @throws {Error} If no node is provided or if node is not a string.
 * @return {Promise} A Promise that resolves to the retrieved version data.
 */
async function getVersion(node) {
  if (!node) throw new Error('No node provided.')
  if (typeof node != 'string') throw new Error('Node must be a string.')

  if (!Nodes[node]) throw new Error('Node does not exist.')

  const data = await utils.makeRequest(`http${Nodes[node].secure ? 's' : ''}://${Nodes[node].hostname}/version`, {
    headers: {
      Authorization: Nodes[node].password
    },
    port: Nodes[node].port,
    method: 'GET'
  })

  return data
}

/**
 * Retrieves the router planner status for a given node.
 * 
 * @param {string} The node to retrieve router planner status from.
 * @throws {Error} If no node is provided or if node is not a string.
 * @return {Promise} A Promise that resolves to the retrieved router planner status data.
 */
async function getRouterPlannerStatus(node) {
  if (!node) throw new Error('No node provided.')
  if (typeof node != 'string') throw new Error('Node must be a string.')

  if (!Nodes[node]) throw new Error('Node does not exist.')

  const data = await utils.makeRequest(`http${Nodes[node].secure ? 's' : ''}://${Nodes[node].hostname}/v4/routerplanner/status`, {
    headers: {
      Authorization: Nodes[node].password
    },
    port: Nodes[node].port,
    method: 'GET'
  })

  return data
}

/**
 * Unmarks a failed address for a given node.
 * 
 * @param {string} The node to unmark failed address from.
 * @param {string} The address to unmark.
 * @throws {Error} If no node is provided or if node is not a string.
 * @returns {Promise} A Promise that resolves when the request is complete.
 */
async function unmarkFailedAddress(node, address) {
  if (!node) throw new Error('No node provided.')
  if (typeof node != 'string') throw new Error('Node must be a string.')

  if (!Nodes[node]) throw new Error('Node does not exist.')

  if (!address) throw new Error('No address provided.')
  if (typeof address != 'string') throw new Error('Address must be a string.')

  const data = await utils.makeRequest(`http${Nodes[node].secure ? 's' : ''}://${Nodes[node].hostname}/v4/routeplanner/free/address`, {
    headers: {
      Authorization: Nodes[node].password
    },
    body: { address },
    port: Nodes[node].port,
    method: 'GET'
  })

  return data
}

/**
 * Unmarks all failed addresses for a given node.
 * 
 * @param {string} The node to unmark failed addresses from.
 * @throws {Error} If no node is provided or if node is not a string.
 * @returns {Promise} A Promise that resolves when the request is complete.
 */
async function unmarkAllFailedAddresses(node) {
  if (!node) throw new Error('No node provided.')
  if (typeof node != 'string') throw new Error('Node must be a string.')

  if (!Nodes[node]) throw new Error('Node does not exist.')

  const data = await utils.makeRequest(`http${Nodes[node].secure ? 's' : ''}://${Nodes[node].hostname}/v4/routeplanner/free/all`, {
    headers: {
      Authorization: Nodes[node].password
    },
    port: Nodes[node].port,
    method: 'GET'
  })

  return data
}

/**
 * Handles raw data received from an external source.
 *
 * @param {Object} The raw data to handle.
 * @throws {Error} If data is not provided or if data is not an object.
 */
function handleRaw(data) {
  switch (data.t) {
    case 'VOICE_SERVER_UPDATE': {
      if (!sessionIds[data.d.guild_id]) return;

      const player = new Player(data.d.guild_id)

      if (!player.playerCreated()) return;

      player.update({
        voice: {
          token: data.d.token,
          endpoint: data.d.endpoint,
          sessionId: sessionIds[data.d.guild_id]
        }
      })

      delete sessionIds[data.d.guild_id]

      break
    }

    case 'VOICE_STATE_UPDATE': {
      if (data.d.member.user.id == Config.botId)
        sessionIds[data.d.guild_id] = data.d.session_id

      break
    }
  }
}

export default {
  node: {
    connectNodes,
    anyNodeAvailable
  },
  player: {
    Player,
    getPlayers
  },
  routerPlanner: {
    getRouterPlannerStatus,
    unmarkFailedAddress,
    unmarkAllFailedAddresses
  },
  other: {
    getInfo,
    getStats,
    getVersion,
    handleRaw
  }
}
