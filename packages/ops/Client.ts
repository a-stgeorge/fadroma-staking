import type { Message } from './Core'
import type { Agent } from './Agent'

export interface ClientConfig {
  agent?:    Agent
  address?:  string
  codeHash?: string
  label?:    string
}

export interface ClientConstructor<C extends Client> {
  new (options: ClientConfig): C
}

export class Client {

  readonly agent: Agent
  address:  string
  codeHash: string
  label:    string

  constructor (options: ClientConfig = {}) {
    Object.assign(this, options)
    if (!this.address) {
      console.warn(
        `@fadroma/ops/Client: `+
        `No contract instance provided. ` +
        `Constructing blank ${this.constructor.name}. ` +
        `Transactions and queries not possible.`
      )
    }
    if (!this.agent) {
      console.warn(
        `@fadroma/ops/Client: `+
        `No agent provided. ` +
        `Constructing blank ${this.constructor.name}. ` +
        `Transactions and queries not possible.`
      )
    }
  }

  async populate () {
    this.label = await this.agent.getLabel(this.address)
  }

  protected query   = (msg: Message) =>
    this.agent.query(this, msg)

  protected execute = (msg: Message, memo?, funds?) =>
    this.agent.execute(this, msg, memo, funds)

  switchAgent = (agent: Agent) => new (this.constructor as ClientConstructor<typeof this>)({
    ...this,
    agent,
  })

}
