import { PresenceChannel } from './presence-channel';
import { PrivateChannel } from './private-channel';
import { Log } from './../log';
import {RedisDatabase} from "../database/redis";

export class Channel {
    /**
     * Channels and patters for private channels.
     *
     * @type {array}
     */
    protected _privateChannels: string[] = ['private-*', 'presence-*'];
    /**
     * Channels and patters for private channels.
     *
     * @type {string}
     */
    protected _appChannel: string = 'app-*';

    /**
     * Allowed client events
     *
     * @type {array}
     */
    protected _clientEvents: string[] = ['client-*'];

    /**
     * Private channel instance.
     *
     * @type {PrivateChannel}
     */
    private: PrivateChannel;

    /**
     * Presence channel instance.
     *
     * @type {PresenceChannel}
     */
    presence: PresenceChannel;

    /**
     * @type {RedisDatabase}
     */
    private redisConnection: RedisDatabase;

    /**
     * Create a new channel instance.
     */
    constructor(private io, private options) {
        this.private = new PrivateChannel(options);
        this.presence = new PresenceChannel(io, options);

        Log.success('Channels are ready.');

        if (options.database === 'redis') {
            this.redisConnection = new RedisDatabase(options);
        }
    }

    /**
     * Join a channel.
     *
     * @param  {object} socket
     * @param  {object} data
     * @return {void}
     */
    join(socket, data): void {
        if (data.channel) {
            if (this.isPrivate(data.channel)) {
                this.joinPrivate(socket, data);
            } else {
                socket.join(data.channel);
                this.onJoin(socket, data.channel);
            }
        }
    }

    /**
     * Trigger a client message
     *
     * @param  {object} socket
     * @param  {object} data
     * @return {void}
     */
    clientEvent(socket, data): void {
        if (this.isEventAcceptable(socket, data)) {
            if (this.toApplication(data)) {
                this.sendDataToApplication(data);
            } else {
                this.io.sockets.connected[socket.id]
                    .broadcast.to(data.channel)
                    .emit(data.event, data.channel, data.data);
            }
        }
    }

    /**
     * Leave a channel.
     *
     * @param  {object} socket
     * @param  {string} channel
     * @param  {string} reason
     * @return {void}
     */
    leave(socket: any, channel: string, reason: string): void {
        if (channel) {
            if (this.isPresence(channel)) {
                this.presence.leave(socket, channel)
            }

            socket.leave(channel);

            if (this.options.devMode) {
                Log.info(`[${new Date().toLocaleTimeString()}] - ${socket.id} left channel: ${channel} (${reason})`);
            }
        }
    }

    /**
     * Check if the incoming socket connection is a private channel.
     *
     * @param  {string} channel
     * @return {boolean}
     */
    isPrivate(channel: string): boolean {
        let isPrivate = false;

        this._privateChannels.forEach(privateChannel => {
            let regex = new RegExp(privateChannel.replace('\*', '.*'));
            if (regex.test(channel)) isPrivate = true;
        });

        return isPrivate;
    }

    /**
     * Join private channel, emit data to presence channels.
     *
     * @param  {object} socket
     * @param  {object} data
     * @return {void}
     */
    joinPrivate(socket: any, data: any): void {
        this.private.authenticate(socket, data).then(res => {
            socket.join(data.channel);

            if (this.isPresence(data.channel)) {
                var member = res.channel_data;
                try {
                    member = JSON.parse(res.channel_data);
                } catch (e) { }

                this.presence.join(socket, data.channel, member);
            }

            this.onJoin(socket, data.channel);
        }, error => {
            Log.error(error.reason);

            this.io.sockets.to(socket.id)
                .emit('subscription_error', data.channel, error.status);
        });
    }

    /**
     * Check if a channel is a presence channel.
     *
     * @param  {string} channel
     * @return {boolean}
     */
    isPresence(channel: string): boolean {
        return channel.lastIndexOf('presence-', 0) === 0;
    }

    /**
     * On join a channel log success.
     *
     * @param {any} socket
     * @param {string} channel
     */
    onJoin(socket: any, channel: string): void {
        if (this.options.devMode) {
            Log.info(`[${new Date().toLocaleTimeString()}] - ${socket.id} joined channel: ${channel}`);
        }
    }

    /**
     * Check if client is a client event
     *
     * @param  {string} event
     * @return {boolean}
     */
    isClientEvent(event: string): boolean {
        let isClientEvent = false;

        this._clientEvents.forEach(clientEvent => {
            let regex = new RegExp(clientEvent.replace('\*', '.*'));
            if (regex.test(event)) isClientEvent = true;
        });

        return isClientEvent;
    }

    /**
     * Check if a socket has joined a channel.
     *
     * @param socket
     * @param channel
     * @returns {boolean}
     */
    isInChannel(socket: any, channel: string): boolean {
        return !!socket.rooms[channel];
    }

    /**
     *  Checks if the client event is processable
     * @param socket
     * @param data
     * @returns {boolean}
     */
    isEventAcceptable(socket: any, data: any): boolean {
        if (!data.channel || !data.event) {
            return false;
        }

        return this.isClientEvent(data.event) &&
            this.isPrivate(data.channel) &&
            this.isInChannel(socket, data.channel);
    }

    /**
     * Checks if the given data is destined to the server application
     * @param data
     * @returns {boolean}
     */
    toApplication(data): boolean {
        return !!data.toApplication && data.appChannel;
    }

    /**
     * Checks if the given channel name is correct application channel name
     * @param {string} channel
     * @returns {boolean}
     */
    isAppChannel(channel: string): boolean {
        return new RegExp('^' + this._appChannel.replace('*', '.*')).test(channel);
    }

    /**
     * Sends the given data to application via redis if it is used in
     * @param data
     */
    sendDataToApplication(data): void {
        if (!this.redisConnection) {
            return;
        }

        let channel = data.appChannel;

        if (!this.isAppChannel(data.appChannel)) {
            channel = this._appChannel.replace('*', '') + channel;
        }

        data.data.sourceChannel = data.channel;
        Log.info(`Sending data to application channel: ${channel}`);

        this.redisConnection.publish(channel, data.data);
    };
}
