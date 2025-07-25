import BrowserSession from '../BrowserSession';
import { trigger } from '../services/Handler';
import { GOOGLE_STUN_SERVER, SwEvent, TURN_SERVER } from '../util/constants';
import { createWebRTCStatsReporter, WebRTCStatsReporter } from '../util/debug';

import { isFunction } from '../util/helpers';
import logger from '../util/logger';
import {
  attachMediaStream,
  muteMediaElement,
  RTCPeerConnection,
  sdpToJsonHack,
  streamIsValid,
} from '../util/webrtc';
import { PeerType } from './constants';
import {
  getMediaConstraints,
  getUserMedia,
  sdpBitrateASHack,
  sdpBitrateHack,
  sdpMediaOrderHack,
  sdpStereoHack,
} from './helpers';
import { IVertoCallOptions } from './interfaces';
/**
 * @ignore Hide in docs output
 */
export default class Peer {
  public instance: RTCPeerConnection;
  public onSdpReadyTwice: Function = null;
  private _constraints: {
    offerToReceiveAudio: boolean;
    offerToReceiveVideo: boolean;
  };

  private statsReporter: WebRTCStatsReporter | null = null;
  private _session: BrowserSession;
  private _negotiating: boolean = false;

  constructor(
    public type: PeerType,
    private options: IVertoCallOptions,
    session: BrowserSession
  ) {
    logger.info('New Peer with type:', this.type, 'Options:', this.options);

    this._constraints = {
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    };

    this._sdpReady = this._sdpReady.bind(this);
    this.handleSignalingStateChangeEvent =
      this.handleSignalingStateChangeEvent.bind(this);
    this.handleNegotiationNeededEvent =
      this.handleNegotiationNeededEvent.bind(this);
    this.handleTrackEvent = this.handleTrackEvent.bind(this);
    this.createPeerConnection = this.createPeerConnection.bind(this);

    this._session = session;

    this._init();

    if (this.isDebugEnabled) {
      this.statsReporter = createWebRTCStatsReporter(session);
    }
  }

  get isOffer() {
    return this.type === PeerType.Offer;
  }

  get isAnswer() {
    return this.type === PeerType.Answer;
  }

  get isDebugEnabled() {
    return this.options.debug || this._session.options.debug;
  }

  get debugOutput() {
    return this.options.debugOutput || this._session.options.debugOutput;
  }
  startNegotiation() {
    this._negotiating = true;

    if (this._isOffer()) {
      this._createOffer();
    } else {
      this._createAnswer();
    }
  }

  private _logTransceivers() {
    logger.info(
      'Number of transceivers:',
      this.instance.getTransceivers().length
    );
    this.instance.getTransceivers().forEach((tr, index) => {
      logger.info(
        `>> Transceiver [${index}]:`,
        tr.mid,
        tr.direction,
        tr.stopped
      );
      logger.info(
        `>> Sender Params [${index}]:`,
        JSON.stringify(tr.sender.getParameters(), null, 2)
      );
    });
  }

  private handleSignalingStateChangeEvent(event) {
    logger.info('signalingState:', this.instance.signalingState);

    switch (this.instance.signalingState) {
      case 'stable':
        // Workaround to skip nested negotiations
        // Chrome bug: https://bugs.chromium.org/p/chromium/issues/detail?id=740501
        this._negotiating = false;
        break;
      case 'closed':
        this.instance = null;
        break;
      default:
        this._negotiating = true;
    }
  }

  private handleNegotiationNeededEvent() {
    logger.info('Negotiation needed event');
    if (this.instance.signalingState !== 'stable') {
      return;
    }
    this.startNegotiation();
  }

  private handleTrackEvent(event) {
    const {
      streams: [first],
    } = event;
    const { remoteElement, screenShare } = this.options;
    let { remoteStream } = this.options;

    remoteStream = first;

    if (screenShare === false) {
      attachMediaStream(remoteElement, remoteStream);
    }
  }

  private handleConnectionStateChange = async (event: Event) => {
    const { connectionState } = this.instance;
    console.log(
      `[${new Date().toISOString()}] Connection State`,
      connectionState
    );

    if (connectionState === 'failed' || connectionState === 'disconnected') {
      const onConnectionOnline = () => {
        this.instance.restartIce();
        this._session._closeConnection();
        this._session.connect();
        window.removeEventListener('online', onConnectionOnline);
      };

      if (navigator.onLine) {
        return onConnectionOnline();
      }
      window.addEventListener('online', onConnectionOnline);
    }
  };

  private async createPeerConnection() {
    this.instance = RTCPeerConnection(this._config());

    this.instance.onsignalingstatechange = this.handleSignalingStateChangeEvent;
    this.instance.onnegotiationneeded = this.handleNegotiationNeededEvent;
    this.instance.ontrack = this.handleTrackEvent;
    this.instance.addEventListener(
      'connectionstatechange',
      this.handleConnectionStateChange
    );
    this.instance.addEventListener(
      'iceconnectionstatechange',
      this._handleIceConnectionStateChange
    );
    this.instance.addEventListener(
      'icegatheringstatechange',
      this._handleIceGatheringStateChange
    ); //@ts-ignore
    this.instance.addEventListener('addstream', (event: MediaStreamEvent) => {
      this.options.remoteStream = event.stream;
    });

    this.options.localStream = await this._retrieveLocalStream().catch(
      (error) => {
        trigger(SwEvent.MediaError, error, this.options.id);
        return null;
      }
    );
  }

  private _handleIceConnectionStateChange = (event) => {
    console.log(
      `[${new Date().toISOString()}] ICE Connection State`,
      this.instance.iceConnectionState
    );
  };
  private _handleIceGatheringStateChange = (event) => {
    console.log(
      `[${new Date().toISOString()}] ICE Gathering State`,
      this.instance.iceGatheringState
    );
  };
  private async _init() {
    await this.createPeerConnection();
    await this.statsReporter?.start(
      this.instance,
      this._session.sessionid,
      this._session.sessionid
    );

    const {
      localElement,
      localStream = null,
      screenShare = false,
    } = this.options;

    if (streamIsValid(localStream)) {
      const audioTracks = localStream.getAudioTracks();
      logger.info('Local audio tracks: ', audioTracks);
      const videoTracks = localStream.getVideoTracks();
      logger.info('Local video tracks: ', videoTracks);
      // FIXME: use transceivers way only for offer - when answer gotta match mid from the ones from SRD
      if (this.isOffer && typeof this.instance.addTransceiver === 'function') {
        // Use addTransceiver
        const transceiverParams: RTCRtpTransceiverInit = {
          direction: 'sendrecv',
          streams: [localStream],
        };

        audioTracks.forEach((track) => {
          this.options.userVariables.microphoneLabel = track.label;
          const transceiver = this.instance.addTransceiver(
            track,
            transceiverParams
          );
          this._setAudioCodec(transceiver);
        });

        console.debug('Applying video transceiverParams', transceiverParams);
        videoTracks.forEach((track) => {
          this.options.userVariables.cameraLabel = track.label;
          this.instance.addTransceiver(track, transceiverParams);
        });
      } else if (typeof this.instance.addTrack === 'function') {
        // Use addTrack

        audioTracks.forEach((track) => {
          this.options.userVariables.microphoneLabel = track.label;
          this.instance.addTrack(track, localStream);
        });
        this.instance
          .getTransceivers()
          .forEach((trans) => this._setAudioCodec(trans));

        videoTracks.forEach((track) => {
          this.options.userVariables.cameraLabel = track.label;
          this.instance.addTrack(track, localStream);
        });
      } else {
        // Fallback to legacy addStream ..
        // @ts-ignore
        this.instance.addStream(localStream);
      }

      if (screenShare === false) {
        muteMediaElement(localElement);
        attachMediaStream(localElement, localStream);
      }
    }

    if (this.isOffer) {
      if (this.options.negotiateAudio) {
        this._checkMediaToNegotiate('audio');
      }
      if (this.options.negotiateVideo) {
        this._checkMediaToNegotiate('video');
      }
    } else {
      this.startNegotiation();
    }

    this._logTransceivers();
  }

  private _getSenderByKind(kind: string) {
    return this.instance
      .getSenders()
      .find(({ track }) => track && track.kind === kind);
  }

  private _checkMediaToNegotiate(kind: string) {
    // addTransceiver of 'kind' if not present
    const sender = this._getSenderByKind(kind);
    if (!sender) {
      const transceiver = this.instance.addTransceiver(kind);
      logger.info('Add transceiver', kind, transceiver);
    }
  }

  private async _createOffer() {
    if (!this._isOffer()) {
      return;
    }
    this._constraints.offerToReceiveAudio = Boolean(this.options.audio);
    this._constraints.offerToReceiveVideo = Boolean(this.options.video);
    logger.info('_createOffer - this._constraints', this._constraints);
    // FIXME: Use https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpTransceiver when available (M71)
    await this.instance
      .createOffer(this._constraints)
      .then(this._setLocalDescription.bind(this))
      .then(this._sdpReady)
      .catch((error) => logger.error('Peer _createOffer error:', error));
  }

  private async _setRemoteDescription(
    remoteDescription: RTCSessionDescriptionInit
  ) {
    await this.instance.setRemoteDescription(remoteDescription);
  }

  private async _createAnswer() {
    if (!this._isAnswer()) {
      return;
    }
    if (this.instance.signalingState !== 'stable') {
      console.log(
        "  - But the signaling state isn't stable, so triggering rollback"
      );

      // Set the local and remove descriptions for rollback; don't proceed
      // until both return.
      await Promise.all([
        this.instance.setLocalDescription({ type: 'rollback' }),
        this.instance.setRemoteDescription({
          sdp: this.options.remoteSdp,
          type: PeerType.Offer,
        }),
      ]);
      return;
    }
    await this._setRemoteDescription({
      sdp: this.options.remoteSdp,
      type: PeerType.Offer,
    });
    this._logTransceivers();
    const answer = await this.instance.createAnswer();
    await this._setLocalDescription(answer);
  }

  private async _setLocalDescription(
    sessionDescription: RTCSessionDescriptionInit
  ) {
    const {
      useStereo,
      googleMaxBitrate,
      googleMinBitrate,
      googleStartBitrate,
      mediaSettings,
    } = this.options;

    if (useStereo) {
      sessionDescription.sdp = sdpStereoHack(sessionDescription.sdp);
    }

    if (googleMaxBitrate && googleMinBitrate && googleStartBitrate) {
      sessionDescription.sdp = sdpBitrateHack(
        sessionDescription.sdp,
        googleMaxBitrate,
        googleMinBitrate,
        googleStartBitrate
      );
    }

    if (
      mediaSettings &&
      mediaSettings.useSdpASBandwidthKbps &&
      mediaSettings.sdpASBandwidthKbps !== null
    ) {
      sessionDescription.sdp = sdpBitrateASHack(
        sessionDescription.sdp,
        mediaSettings.sdpASBandwidthKbps
      );
    }
    await this.instance.setLocalDescription(sessionDescription);
  }

  private _setAudioCodec = (transceiver: RTCRtpTransceiver) => {
    if (
      !this.options.preferred_codecs ||
      this.options.preferred_codecs.length === 0
    ) {
      return;
    }
    if (transceiver.setCodecPreferences) {
      return transceiver.setCodecPreferences(this.options.preferred_codecs);
    }
  };
  /** Workaround for ReactNative: first time SDP has no candidates */
  private _sdpReady(): void {
    if (isFunction(this.onSdpReadyTwice)) {
      this.onSdpReadyTwice(this.instance.localDescription);
    }
  }

  private async _retrieveLocalStream() {
    if (streamIsValid(this.options.localStream)) {
      return this.options.localStream;
    }
    const constraints = await getMediaConstraints(this.options);
    return getUserMedia(constraints);
  }

  private _isOffer(): boolean {
    return this.type === PeerType.Offer;
  }

  private _isAnswer(): boolean {
    return this.type === PeerType.Answer;
  }

  private _config(): RTCConfiguration {
    const { prefetchIceCandidates, forceRelayCandidate } = this.options;

    const config: RTCConfiguration = {
      bundlePolicy: 'max-compat',
      iceCandidatePoolSize: prefetchIceCandidates ? 10 : 0,
      iceServers: [GOOGLE_STUN_SERVER, TURN_SERVER],
      iceTransportPolicy: forceRelayCandidate ? 'relay' : 'all',
    };

    logger.info('RTC config', config);
    return config;
  }

  public async close() {
    await this.statsReporter?.stop(this.debugOutput);
    if (this.instance) {
      this.instance.close();
      this.instance = null;
    }
  }
}
