import { Console, bold, colors, resolve, readFileSync, JSONDirectory } from '@hackbg/toolbox'
import { toBase64 } from '@iov/encoding'
import {
  Identity, Gas, Source, Artifact, Template, Label, InitMsg, Instance, Message, getMethod
} from './Core'
import { Trace } from './Trace'
import type { Chain } from './Chain'
import type { Bundle } from './Bundle'

const console = Console('Fadroma Agent')

export type AgentConstructor = (new (Identity) => Agent) & { create: (any) => Agent }

export abstract class Agent implements Identity {

  constructor (
    chain: Chain,
  ) {
    this.chain = chain
  }

  trace = new Trace("unnamed", console)

  abstract readonly address: string

  readonly chain:   Chain
  readonly name:    string
  fees: Record<string, any>

  type?:     string

  /** Get current block height. */
  abstract get block (): Promise<any>

  /** Wait until block height increments. */
  get nextBlock () {
    return this.waitUntilNextBlock()
  }

  /** Wait until block height increments. */
  async waitUntilNextBlock (
    interval: number = 1000
  ) {
    console.info(
      bold('Waiting until next block with'), this.address
    )
    // starting height
    const {header:{height}} = await this.block
    //console.info(bold('Block'), height)
    // every `interval` msec check if the height has increased
    return new Promise<void>(async resolve=>{
      while (true) {
        // wait for `interval` msec
        await new Promise(ok=>setTimeout(ok, interval))
        // get the current height
        const now = await this.block
        //console.info(bold('Block'), now.header.height)
        // check if it went up
        if (now.header.height > height) {
          resolve()
          break
        }
      }
    })
  }

  /** Get up-to-date account info for this agent's address. */
  abstract get account (): Promise<any>

  /** Get up-to-date balance of this address in `this.defaultDenomination` */
  get balance () { return this.getBalance() }

  /** Default denomination for native token. */
  abstract readonly defaultDenomination: string

  /** Get up-to-data balance of this address in specified denomination. */
  async getBalance (denomination: string = this.defaultDenomination) {
    const account = await this.account
    const balance = account.balance || []
    const inDenom = ({denom}) => denom === denomination
    const balanceInDenom = balance.filter(inDenom)[0]
    if (!balanceInDenom) return 0
    return balanceInDenom.amount
  }

  abstract send (to: any, amt: string|number, denom?: any, memo?: any, fee?: any): Promise<any>

  abstract sendMany (txs: any[], memo?: string, denom?: string, fee?: any): Promise<any>

  abstract upload (artifact: Artifact): Promise<Template>

  /** Instantiate a single contract. */
  async instantiate (
    template: Template,
    label:    string,
    msg:      any,
    funds:    any[] = []
  ): Promise<Instance> {
    if (!template) {
      throw new Error('@fadroma/ops/Agent: need a Template to instantiate')
    }
    const { chainId, codeId } = template
    if (!chainId || !codeId) {
      throw new Error('@fadroma/scrt: Template must contain chainId and codeId')
    }
    if (chainId !== this.chain.id) {
      throw new Error(`@fadroma/scrt: Template is from chain ${chainId}, we're on ${this.chain.id}`)
    }
    const traceId = await this.trace.initCall(codeId, label)
    const result  = await this.doInstantiate(template, label, msg, funds)
    this.trace.initResponse(traceId, result)
    return result
  }

  /** Instantiate multiple contracts in 1 tx via a Bundle. */
  async instantiateMany (
    configs: [Template, Label, InitMsg][],
    prefix?: string
  ): Promise<Record<string, Instance>> {
    // results by tx order
    const results = await this.bundle().wrap(
      bundle => bundle.instantiateMany(configs, prefix)
    )
    // results by contract name
    const receipts = {}
    for (const i in configs) {
      const label  = configs[i][1]
      const result = results[i]
      receipts[label] = {
        name:            label,
        chainId:         result.chainId,
        codeId:          Number(result.codeId),
        codeHash:        result.codeHash,
        label:           prefix?`${prefix}/${label}`:label,
        address:         result.address,
        transactionHash: result.tx
      }
    }
    return receipts
  }

  protected abstract doInstantiate (
    template: { chainId: string, codeId: string }, label: string, msg: any, funds: any[]
  ): Promise<any>

  abstract getLabel  (address: string): Promise<string>
  abstract getCodeId (address: string): Promise<number>

  /** Perform a smart contract query. */
  async query (
    contract: { address: string, label: string }, msg: any
  ): Promise<any> {
    const traceId = this.trace.queryCall(contract, msg)
    const response = await this.doQuery(contract, msg)
    this.trace.queryResponse(traceId, response)
    return response
  }

  protected abstract doQuery (
    contract: { address: string }, msg: any
  ): Promise<any>

  /** Execute a regular smart contract transaction. */
  async execute (
    contract: { address: string, label: string }, msg: Message, funds: any[], memo?: any, fee?: any
  ): Promise<any> {
    const traceId = this.trace.executeCall(contract, msg, funds, memo, fee)
    const response = await this.doExecute(contract, msg, funds, memo, fee)
    this.trace.executeResponse(traceId, response)
    return response
  }

  protected abstract doExecute (
    contract: { address: string, label: string },
    msg:   Message,
    funds: any[],
    memo?: any,
    fee?:  any
  ): Promise<any>

  abstract Bundle: new(Agent)=>Bundle

  /** Start a new transaction bundle. */
  bundle () {
    if (!this.Bundle) {
      throw new Error('@fadroma/ops/agent: this agent does not support bundling transactions')
    }
    //@ts-ignore
    return new this.Bundle(this)
  }

}
