/**
 * BlockAds Proxy Subscription Converter Types
 */

export type ProxyType =
  | "trojan"
  | "vmess"
  | "vless"
  | "shadowsocks"
  | "hysteria2"
  | "wireguard"
  | "tuic"
  | "unknown";

export interface BaseProxyNode {
  type: ProxyType;
  server: string;
  port: number;
  tag: string;
  raw: string;
}

export interface TrojanNode extends BaseProxyNode {
  type: "trojan";
  password: string;
  sni?: string;
  alpn?: string;
  skipCertVerify?: boolean;
}

export interface VMessNode extends BaseProxyNode {
  type: "vmess";
  uuid: string;
  alterId?: number;
  cipher?: string;
  network?: string;
  tls?: boolean;
  sni?: string;
  path?: string;
  host?: string;
}

export interface VLESSNode extends BaseProxyNode {
  type: "vless";
  uuid: string;
  flow?: string;
  security?: "none" | "tls" | "reality";
  sni?: string;
  alpn?: string;
  pbk?: string; // Reality Public Key
  sid?: string; // Reality Short ID
  spx?: string; // Reality SpiderX
  network?: string;
  path?: string;
}

export interface ShadowsocksNode extends BaseProxyNode {
  type: "shadowsocks";
  cipher: string;
  password: string;
  plugin?: string;
  pluginOpts?: string;
}

export interface Hysteria2Node extends BaseProxyNode {
  type: "hysteria2";
  password: string;
  sni?: string;
  obfs?: string;
  obfsPassword?: string;
}

export interface WireguardNode extends BaseProxyNode {
  type: "wireguard";
  privateKey?: string;
  publicKey?: string;
  ip?: string;
  mtu?: number;
  reserved?: number[];
}

export interface TUICNode extends BaseProxyNode {
  type: "tuic";
  uuid: string;
  password: string;
  sni?: string;
  congestionControl?: string;
  alpn?: string;
}

export interface OtherNode extends BaseProxyNode {
  type: "unknown";
}

export type ProxyNode =
  | TrojanNode
  | VMessNode
  | VLESSNode
  | ShadowsocksNode
  | Hysteria2Node
  | WireguardNode
  | TUICNode
  | OtherNode;

export type TargetClient =
  | "quanx"
  | "clash"
  | "singbox"
  | "shadowrocket"
  | "surge"
  | "loon"
  | "base64";

export interface ConversionOptions {
  target: TargetClient;
  includeRules?: boolean;
  emojiFlags?: boolean;
  filterRegex?: string;
  excludeRegex?: string;
  udp?: boolean;
}
