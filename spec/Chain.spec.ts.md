# `@fadroma/ops/Chain` spec

```typescript
import assert from 'assert'
const ChainSpec = {}
const test = tests => Object.assign(ChainSpec, tests)
export default ChainSpec
```

## Chain config

```typescript
import { Chain } from '../index'
test({
  'chain id' () {
    const chain = new Chain('chainid')
    assert(chain.id === 'chainid')
  },
  'chain API URL' () {
    const url = 'http://example.com'
    const chain = new Chain('chainid', { url })
    assert(chain.url === url)
  }
})
```

## Chain modes

```typescript
import { ChainMode, Agent } from '../index'
test({
  'mainnet' () {
    const mode = ChainMode.Mainnet
    const chain = new Chain('chainid', { mode })
    assert(chain.isMainnet)
    assert(!chain.isTestnet)
    assert(!chain.isDevnet)
  },
  'testnet' () {
    const mode = ChainMode.Testnet
    const chain = new Chain('chainid', { mode })
    assert(!chain.isMainnet)
    assert(chain.isTestnet)
    assert(!chain.isDevnet)
  },
  'devnet' () {
    const mode = ChainMode.Devnet
    const chain = new Chain('chainid', { mode })
    assert(!chain.isMainnet)
    assert(!chain.isTestnet)
    assert(chain.isDevnet)
  },
})
```

## Chain features

```typescript
test({
  'Chain#getNonce must be implemented in subclass' ({ throws }) {
    const chain = new Chain('chainid')
    throws(()=>chain.getNonce())
  },
  async 'Chain#getAgent takes name only on devnet' ({ rejects, equal }) {
    const agent = Symbol()
    class TestChain extends Chain {
      Agent = { async create () { return agent } }
    }
    const chain = new TestChain('chainid')
    await rejects(chain.getAgent({ name: 'agent' }))
    chain.node = { getGenesisAccount () { return {} } }
    equal(await chain.getAgent({ name: 'agent' }), agent)
  },
  async 'Chain#getAgent takes Identity object' ({ rejects, ok }) {
    class TestAgent extends Agent {
      static create (options) {
        return new this(options)
      }
    }
    class TestChain extends Chain {
      Agent = TestAgent
    }
    const chain = new TestChain('chainid')
    ok(await chain.getAgent({}) instanceof Agent)
  }
})
```

## Chain-specific variants

* `LegacyScrt`: creates secretjs@0.17.5 based agent using lcd/amino
* `Scrt`: creates secretjs@beta based agent using grpc

```typescript
import { LegacyScrt, Scrt } from '../index'
for (const Chain of [
  LegacyScrt,
  Scrt
  /* add other supported chains here */
]) test({

  async [`${Chain.name}: mainnet`] ({ ok }) {
    ok(await new Chain('main', { mode: Chain.Mode.Mainnet }))
  },

  async [`${Chain.name}: testnet`] ({ ok }) {
    ok(await new Chain('test', { mode: Chain.Mode.Testnet }))
  },

  async [`${Chain.name}: devnet`] ({ ok, equal }) {
    const node = { chainId: 'scrt-devnet', url: 'http://test:0' }
    const chain = await new Chain('dev', { mode: Chain.Mode.Devnet, node })
    ok(chain)
    equal(chain.node, node)
    equal(chain.url,  node.url)
    equal(chain.id,   node.chainId)
  },

})
```
