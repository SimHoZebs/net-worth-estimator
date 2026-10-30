import { appURL, serviceURL } from "./draft.js";

export class Connection {
  constructor(storage, request = globalThis.fetch.bind(globalThis), now = Date.now) {
    this.storage = storage;
    this.request = request;
    this.now = now;
    this.refreshing = null;
    this.epoch = 0;
    this.credentials = Promise.resolve();
  }

  commit(action) {
    const result = this.credentials.then(action);
    this.credentials = result.catch(() => {});
    return result;
  }

  async disconnect() {
    const epoch = ++this.epoch;
    await this.commit(async () => {
      await this.storage.local.remove("connection");
      await this.storage.session.remove(["access", "pendingLogin", "identity"]);
    });
    return epoch;
  }

  async start(origin) {
    const base = appURL(origin);
    const epoch = await this.disconnect();
    const result = await this.raw(base, "/v1/auth/device/start", {});
    serviceURL(result.verificationUri);
    if (!result.deviceCode || !result.userCode || !(result.expiresIn > 0))
      throw new Error("The app did not return a valid sign-in request.");
    const pending = {
      base,
      ...result,
      expiresAt: this.now() + result.expiresIn * 1000,
      interval: Math.max(5, result.interval || 5),
      nextPoll: 0,
    };
    await this.commit(async () => {
      if (epoch !== this.epoch) throw new Error("The connection changed. Retry.");
      await this.storage.session.set({ pendingLogin: pending });
    });
    return { verificationUri: result.verificationUri, userCode: result.userCode };
  }

  async poll() {
    const epoch = this.epoch;
    const { pendingLogin: pending } = await this.storage.session.get("pendingLogin");
    if (!pending) return false;
    if (pending.expiresAt <= this.now()) {
      await this.storage.session.remove("pendingLogin");
      throw new Error("Sign-in expired. Connect again.");
    }
    if (pending.nextPoll > this.now()) return false;
    await this.commit(async () => {
      if (epoch !== this.epoch) throw new Error("The connection changed. Retry.");
      await this.storage.session.set({
        pendingLogin: { ...pending, nextPoll: this.now() + pending.interval * 1000 },
      });
    });
    let tokens;
    try {
      tokens = await this.raw(pending.base, "/v1/auth/device/poll", {
        deviceCode: pending.deviceCode,
      });
    } catch (error) {
      if ([403, 410].includes(error.status)) await this.storage.session.remove("pendingLogin");
      throw error;
    }
    if (epoch !== this.epoch) return false;
    if (tokens.status === "pending") return false;
    await this.keepTokens(pending.base, tokens, epoch);
    await this.commit(async () => {
      if (epoch === this.epoch) await this.storage.session.remove("pendingLogin");
    });
    await this.identity();
    return true;
  }

  async keepTokens(base, tokens, epoch) {
    if (!tokens.accessToken || !tokens.refreshToken || !(tokens.expiresIn > 0))
      throw new Error("The app did not return valid credentials.");
    await this.commit(async () => {
      if (epoch !== this.epoch) throw new Error("The connection changed. Retry.");
      await this.storage.local.set({ connection: { base, refreshToken: tokens.refreshToken } });
      await this.storage.session.set({
        access: { token: tokens.accessToken, expiresAt: this.now() + tokens.expiresIn * 1000 },
      });
    });
  }

  async token(force = false) {
    await this.credentials;
    const { access } = await this.storage.session.get("access");
    if (!force && access?.expiresAt > this.now() + 30000) return access.token;
    if (!this.refreshing) {
      const epoch = this.epoch;
      this.refreshing = (async () => {
        const { connection } = await this.storage.local.get("connection");
        if (!connection) throw new Error("Connect to Waypoint first.");
        const tokens = await this.raw(connection.base, "/v1/auth/device/refresh", {
          refreshToken: connection.refreshToken,
        });
        await this.keepTokens(connection.base, tokens, epoch);
        return tokens.accessToken;
      })()
        .catch(async (error) => {
          if (error.status === 401) await this.storage.session.remove(["access", "identity"]);
          throw error;
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }

  async raw(base, path, body, token, resource) {
    const response = await this.request(base + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(20000),
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(resource ? { "Waypoint-Resource": resource } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(
        result.detail || "The app request failed. Retry without discarding your draft.",
      );
      error.status = response.status;
      throw error;
    }
    return result;
  }

  async api(path, body, resource) {
    const epoch = this.epoch;
    await this.credentials;
    const { connection } = await this.storage.local.get("connection");
    if (!connection) throw new Error("Connect to Waypoint first.");
    const token = await this.token();
    if (epoch !== this.epoch) throw new Error("The connection changed. Retry.");
    let result;
    try {
      result = await this.raw(connection.base, path, body, token, resource);
    } catch (error) {
      if (error.status !== 401) throw error;
      if (epoch !== this.epoch) throw new Error("The connection changed. Retry.");
      const refreshed = await this.token(true);
      if (epoch !== this.epoch) throw new Error("The connection changed. Retry.");
      result = await this.raw(connection.base, path, body, refreshed, resource);
    }
    if (epoch !== this.epoch) throw new Error("The connection changed. Retry.");
    return result;
  }

  async identity() {
    const epoch = this.epoch;
    const identity = await this.api("/v1/auth/session");
    if (!identity.authenticated || !identity.resource?.id) {
      await this.commit(async () => {
        if (epoch === this.epoch) await this.storage.session.remove(["access", "identity"]);
      });
      throw new Error("Reconnect to Waypoint to access your financial model.");
    }
    await this.commit(async () => {
      if (epoch !== this.epoch) throw new Error("The connection changed. Retry.");
      await this.storage.session.set({ identity });
    });
    return identity;
  }
}
