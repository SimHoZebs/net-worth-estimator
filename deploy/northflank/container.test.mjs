import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const image = process.env.NORTHFLANK_TEST_IMAGE;
const docker = async (...args) => (await exec("docker", args, { timeout: 120000 })).stdout.trim();

test("Northflank target persists learning and supervises both processes within Sandbox limits", { skip: !image, timeout: 240000 }, async (t) => {
  const name = `nwe-northflank-${randomUUID()}`;
  const volume = `${name}-data`;
  t.after(async () => {
    await docker("rm", "--force", name).catch(() => {});
    await docker("volume", "rm", volume).catch(() => {});
  });
  const config = JSON.parse(await docker("image", "inspect", image))[0].Config;
  assert.equal(config.User, "app:app");
  assert.deepEqual(config.Cmd, ["python", "/app/northflank-runtime.py"]);
  const boot = `
set -eu
mkdir -p /tmp/provider/.well-known
printf '%s' '{"issuer":"http://127.0.0.1:18000","authorization_endpoint":"http://127.0.0.1:18000/authorize","token_endpoint":"http://127.0.0.1:18000/token","jwks_uri":"http://127.0.0.1:18000/jwks","introspection_endpoint":"http://127.0.0.1:18000/introspect","backchannel_logout_supported":true}' > /tmp/provider/.well-known/openid-configuration
busybox-extras httpd -p 18000 -h /tmp/provider
if [ ! -f "$NET_WORTH_ESTIMATOR_AUTHZ_DB" ]; then
  /app/authzctl --setup --db "$NET_WORTH_ESTIMATOR_AUTHZ_DB" --issuer "$NET_WORTH_ESTIMATOR_AUTH_ISSUER" --guest "$NET_WORTH_ESTIMATOR_GUEST_SUBJECT"
fi
exec python /app/northflank-runtime.py
`;
  await docker("run", "--detach", "--network", "none", "--memory", "256m", "--memory-swap", "256m", "--cpus", "0.1",
    "--name", name, "--mount", `type=volume,source=${volume},target=/data`,
    "--env", "PORT=10000",
    "--env", "NET_WORTH_ESTIMATOR_AUTH_ISSUER=http://127.0.0.1:18000",
    "--env", "NET_WORTH_ESTIMATOR_AUTH_CLIENT_ID=fixture",
    "--env", "NET_WORTH_ESTIMATOR_AUTH_CLIENT_SECRET=fixture-secret",
    "--env", "NET_WORTH_ESTIMATOR_PUBLIC_URL=http://localhost:8080",
    "--env", "NET_WORTH_ESTIMATOR_GUEST_SUBJECT=disposable-guest",
    "--env", "NET_WORTH_ESTIMATOR_AUTHZ_DB=/data/authorization.db",
    "--env", "NET_WORTH_ESTIMATOR_PROXY_SECRET=0123456789abcdef0123456789abcdef",
    image, "/bin/sh", "-c", boot);

  async function ready() {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      try {
        assert.equal(await docker("exec", name, "busybox", "wget", "-qO-", "http://127.0.0.1:10000/readyz"), "ok");
        return;
      } catch {
        const state = JSON.parse(await docker("inspect", name))[0].State;
        const logs = state.Running ? "" : await exec("docker", ["logs", name]);
        assert.ok(state.Running, `Container stopped: ${logs.stdout}\n${logs.stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    assert.fail(`Container not ready: ${await docker("logs", name)}`);
  }
  await ready();
  const feedback = `
import copy,json,urllib.request
def post(path,payload):
    req=urllib.request.Request('http://127.0.0.1:8766/'+path,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
    return json.load(urllib.request.urlopen(req,timeout=10))
request={'id':'immutable-request','kind':'income','patternId':'owner-account-pattern','question':{'label':'income','supportSignals':['payroll-descriptor'],'candidateSignals':[],'excludeSignals':[],'suggestWithoutSignal':True},'pattern':{'merchant':'acme','cadence':'biweekly','currency':'USD','typicalAmount':'2000.00','annualizedEstimate':'52000.00','occurrenceCount':3,'cadenceDays':14,'amountVariation':0,'intervalVariation':0,'recencyDays':0,'direction':'inflow','signals':['payroll-descriptor']},'samples':[]}
before=post('state',{'owner':'fixture'})
batch={'owner':'fixture','after':'','cursor':'001','feedback':[{'eventId':'001','runId':'reviewed-run','action':'confirm','request':request}]}
post('feedback',batch)
post('feedback',batch)
after=post('state',{'owner':'fixture'})
assert after['cursor']=='001' and after['revision']!=before['revision']
assert post('evaluate',{'requests':[request]})['judgments'][0]['status']=='ready'
# Hundreds of semantic hypotheses share this same process and learner. Exercise
# bounded evaluations plus durable training without allocating a model per type.
variants=[]
for i in range(300):
    variant=copy.deepcopy(request)
    variant['id']=f'request-{i}'
    variant['kind']=f'classification-{i}'
    variants.append(variant)
for start in range(0,300,100):
    decisions=post('evaluate',{'requests':variants[start:start+100]})['judgments']
    assert len(decisions)==100 and all(d['decision']=='supported' for d in decisions)
for start,end in [(0,200),(200,300)]:
    events=[{'eventId':f'{i+1:04d}','runId':'scale-run','action':'confirm','request':variants[i]} for i in range(start,end)]
    post('feedback',{'owner':'scale-owner','after':f'{start:04d}' if start else '', 'cursor':f'{end:04d}', 'feedback':events})
after=post('state',{'owner':'fixture'})
print(after['revision'])
`;
  const revision = await docker("exec", name, "python", "-c", feedback);
  const receipts = await docker("exec", name, "sqlite3", "/data/ml.sqlite3", "SELECT COUNT(*) FROM events;");
  assert.equal(receipts, "301");
  const peak = Number(await docker("exec", name, "cat", "/sys/fs/cgroup/memory.peak"));
  t.diagnostic(`Combined deployment peak including test clients: ${(peak / 1024 / 1024).toFixed(1)} MiB at 0.1 vCPU`);
  assert.ok(peak < 256 * 1024 * 1024);
  // A failed provider must terminate the API, rather than leave a partial stack.
  await docker("exec", name, "python", "-c", "import os,signal; from pathlib import Path; [(os.kill(int(p.name),signal.SIGKILL)) for p in Path('/proc').iterdir() if p.name.isdigit() and p.joinpath('cmdline').exists() and b'/app/ml/server.py' in p.joinpath('cmdline').read_bytes() and int(p.name)!=os.getpid()]");
  assert.notEqual(await docker("wait", name), "0");
  assert.equal(JSON.parse(await docker("inspect", name))[0].State.OOMKilled, false);
  await docker("start", name);
  await ready();
  assert.equal(await docker("exec", name, "sqlite3", "/data/ml.sqlite3", "SELECT 'payments-v2:b32768:h0.75:l0.25:' || generation || ':' || revision FROM model;"), revision);
  assert.equal(await docker("exec", name, "sqlite3", "/data/ml.sqlite3", "SELECT cursor FROM checkpoints WHERE owner='fixture';"), "001");
  await docker("stop", "--time", "12", name);
  assert.equal(JSON.parse(await docker("inspect", name))[0].State.ExitCode, 0);
});
