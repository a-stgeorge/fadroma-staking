import LineTransformStream from 'line-transform-stream'

import {
  Console, bold, basename, dirname, relative, resolve, cwd, freePort,
  Directory, JSONDirectory, waitPort, waitUntilLogsSay
} from '@hackbg/tools'
import { Builder, codeHashForPath } from './Core'
import { config } from './Config'
import { Devnet, DevnetOptions } from './Devnet'

const console = Console('@fadroma/ops/Docker')

import Docker from 'dockerode'
export { Docker }

/** Make sure an image is present in the Docker cache,
  * by pulling it if `docker.getImage` throws,
  * or by building it if `docker.pull` throws. */
export async function ensureDockerImage (
  imageName:      string|null = null,
  dockerfilePath: string|null = null,
  docker:         Docker      = new Docker()
): Promise<string> {

  const PULLING  = `Image ${imageName} not found, pulling...`
  const BUILDING = `Image ${imageName} not found upstream, building from ${dockerfilePath}...`
  const NO_DOCKERFILE = `Image ${imageName} not found and no Dockerfile provided; can't proceed.`

  try {
    await checkImage()
  } catch (_e) {
    try {
      console.warn(PULLING)
      await pullImage()
    } catch (_e) {
      if (!dockerfilePath) {
        throw new Error(NO_DOCKERFILE)
      } else {
        console.warn(BUILDING)
        await buildImage()
      }
    }
  }

  return imageName // return just the name

  /** Throws if inspected image does not exist locally. */
  async function checkImage (): Promise<void> {
    const image = docker.getImage(imageName)
    await image.inspect()
  }

  /** Throws if inspected image does not exist in Docker Hub. */
  async function pullImage (): Promise<void> {
    await new Promise<void>((ok, fail)=>docker.pull(
      imageName,
      (err: Error, stream: unknown) => {
        if (err) return fail(err)
        docker.modem.followProgress(
          stream,
          (err: Error, _output: unknown) => {
            if (err) return fail(err)
            console.info(`pull ok`)
            ok()
          },
          (event: Record<string, unknown>) => console.info(
            `📦 docker pull says:`,
            ['id', 'status', 'progress'].map(x=>event[x]).join('│')
          )
        )
      }
    ))
  }

  /* Throws if the build fails, and then you have to fix stuff. */
  async function buildImage (): Promise<void> {
    const dockerfile = basename(dockerfilePath)
    const context = dirname(dockerfilePath)
    const src     = [dockerfile]
    const stream = await docker.buildImage({ context, src }, { t: imageName, dockerfile })
    await new Promise<void>((ok, fail)=>docker.modem.followProgress(
      stream,
      (err: Error, _output: unknown) => {
        if (err) return fail(err)
        console.info(`build ok`)
        ok()
      },
      (event: Record<string, unknown>) => console.info(
        `📦 docker build says:`,
        JSON.stringify(event)
      )
    ))
  }

}

/** This builder launches a one-off build container using Dockerode. */
export class DockerodeBuilder extends Builder {
  constructor (options) {
    super()
    this.image      = options.image
    this.dockerfile = options.dockerfile
    this.script     = options.script
    this.socketPath = options.socketPath || '/var/run/docker.sock'
    this.docker     = new Docker({ socketPath: this.socketPath })
  }
  /** Tag of the docker image for the build container. */
  image:      string
  /** Path to the dockerfile to build the build container if missing. */
  dockerfile: string
  /** Path to the build script to be mounted and executed in the container. */
  script:     string
  /** Used to launch build container. */
  socketPath: string
  /** Used to launch build container. */
  docker:     Docker
  /** Set the first time this Builder instance is used to build something. */
  private ensuringBuildImage: Promise<string>|null = null
  /** If `ensuringBuildImage` is not set, sets it to a Promise that resolves
    * when the build image is available. Returns that Promise every time. */
  private get buildImageReady () {
    if (!this.ensuringBuildImage) {
      console.info(bold('Ensuring build image:'), this.image, 'from', this.dockerfile)
      return this.ensuringBuildImage = ensureDockerImage(this.image, this.dockerfile, this.docker)
    } else {
      console.info(bold('Already ensuring build image from parallel build:'), this.image)
      return this.ensuringBuildImage
    }
  }
  async build (source) {
    // Support optional build caching
    const prebuilt = this.prebuild(source)
    if (prebuilt) {
      return prebuilt
    }
    const { workspace, crate, ref = 'HEAD' } = source
    const outputDir = resolve(workspace, 'artifacts')
    const location  = resolve(outputDir, `${crate}@${ref}.wasm`)
    // Wait until the build image is available.
    const image = await this.buildImageReady
    // Configuration of the build container
    const [cmd, args] = getBuildContainerArgs(workspace, crate, ref, outputDir, this.script)
    // Run the build in the container
    console.debug(
      `Running ${bold(cmd)} in ${bold(image)}`,
      `with the following options:`, args
    )
    const output = new LineTransformStream(line=>{
      const tag = `[${crate}@${ref}]`.padEnd(24)
      return `[@fadroma/ops/Build] ${tag} ${line}`
    })
    output.pipe(process.stdout)
    const running = await this.docker.run(image, cmd, output, args)
    const [{Error: err, StatusCode: code}, container] = running
    // Throw error if build failed
    if (err) {
      throw new Error(`[@fadroma/ops/Build] Docker error: ${err}`)
    }
    if (code !== 0) {
      console.error(bold('Build of'), crate, 'exited with', bold(code))
      throw new Error(`[@fadroma/ops/Build] Build of ${crate} exited with status ${code}`)
    }
    const codeHash = codeHashForPath(location)
    return { location, codeHash }
  }
}

export function getBuildContainerArgs (
  src:     string,
  crate:   string,
  ref:     string,
  output:  string,
  command: string,
): [string, object] {
  const cmdName = basename(command)
  const cmd = `bash /${cmdName} ${crate} ${ref}`
  const binds = []
  binds.push(`${src}:/src:rw`)                         // Input
  binds.push(`${command}:/${cmdName}:ro`)              // Procedure
  binds.push(`${output}:/output:rw`)                   // Output
  binds.push(`project_cache_${ref}:/src/target:rw`)    // Cache
  binds.push(`cargo_cache_${ref}:/usr/local/cargo:rw`) // Cache
  if (ref !== 'HEAD') {
    if (config.buildUnsafeMountKeys) {
      // Keys for SSH cloning of submodules - dangerous!
      console.warn(
        '!!! UNSAFE: Mounting your SSH keys directory into the build container'
      )
      binds.push(`${config.homeDir}/.ssh:/root/.ssh:rw`)
    } else {
      console.warn(
        'Not mounting SSH keys into build container - may not be able to clone submodules'
      )
    }
  }
  const args = { Tty:         true,
                 AttachStdin: true,
                 Entrypoint:  ['/bin/sh', '-c'],
                 HostConfig:  { Binds:      binds,
                                AutoRemove: true },
                 Env:         ['CARGO_NET_GIT_FETCH_WITH_CLI=true',
                               'CARGO_TERM_VERBOSE=true',
                               'CARGO_HTTP_TIMEOUT=240',
                               'LOCKED=',/*'--locked'*/] }
  return [cmd, args]
}
/** Parameters for the Dockerode-based implementation of Devnet.
  * (https://www.npmjs.com/package/dockerode) */
export type DockerodeDevnetOptions = DevnetOptions & {
  /** Docker image of the chain's runtime. */
  image?: string
  /** Init script to launch the devnet. */
  initScript?: string
  /** Once this string is encountered in the log output
    * from the container, the devnet is ready to accept requests. */
  readyPhrase?: string
  /** Handle to Dockerode or compatible (TODO mock!) */
  docker?: {
    getImage (): {
      inspect (): Promise<any>
    }
    pull (image: any, callback: Function): void
    modem: {
      followProgress (
        stream:   any,
        callback: Function,
        progress: Function
      ): any
    }
    getContainer (id: any): {
      id: string,
      start (): Promise<any>
    }
    createContainer (options: any): {
      id: string
      logs (_: any, callback: Function): void
    }
  }
}

/** Fadroma can spawn a devnet in a container using Dockerode.
  * This requires an image name and a handle to Dockerode. */
export class DockerodeDevnet extends Devnet {

  constructor (options: DockerodeDevnetOptions = {}) {
    super(options)
    console.info('Constructing', bold('Dockerode')+'-based devnet')
    if (options.docker) {
      this.docker = options.docker
    }
    this.identities  = this.stateRoot.subdir('identities',  JSONDirectory)
    this.daemonDir   = this.stateRoot.subdir('secretd',     Directory)
    this.clientDir   = this.stateRoot.subdir('secretcli',   Directory)
    this.sgxDir      = this.stateRoot.subdir('sgx-secrets', Directory)
    this.image       = options.image
    this.initScript  = options.initScript
    this.readyPhrase = options.readyPhrase
  }

  /** This should point to the standard production docker image for the network. */
  image: string

  /** Mounted into devnet container in place of default init script
    * in order to add custom genesis accounts with initial balances
    * and store their keys. */
  initScript: string

  /** Mounted out of devnet container to persist keys of genesis wallets. */
  identities: JSONDirectory

  /** Gets the info for a genesis account, including the mnemonic */
  async getGenesisAccount (name: string) {
    return this.identities.load(name)
  }

  /** Mounted out of devnet container to persist secretd state. */
  daemonDir: Directory

  /** Mounted out of devnet container to persist secretcli state. */
  clientDir: Directory

  /** Mounted out of devnet container to persist SGX state. */
  sgxDir: Directory

  /** Once this phrase is encountered in the log output
    * from the container, the devnet is ready to accept requests. */
  readyPhrase: string

  async spawn () {
    // tell the user that we have begun
    console.info(`Spawning new node...`)
    // get a free port
    this.apiURL.port = String(await freePort())
    // create the state dirs and files
    const items = [this.stateRoot, this.nodeState]
    for (const item of items) {
      try {
        item.make()
      } catch (e) {
        console.warn(`Failed to create ${item.path}: ${e.message}`)
      }
    }
    // create the container
    console.info('Launching a devnet container...')
    await ensureDockerImage(this.image, this.docker)
    this.container = await this.createContainer(getDevnetContainerOptions(this))
    const shortId = this.container.id.slice(0, 8)
    // emit any warnings
    if (this.container.Warnings) {
      console.warn(`Creating container ${shortId} emitted warnings:`)
      console.info(this.container.Warnings)
    }
    // report progress
    const shortPath = relative(config.projectRoot, this.nodeState.path)
    console.info(`Created container ${bold(shortId)} (${bold(shortPath)})...`)
    // start the container
    await this.startContainer(this.container.id)
    console.info(`Started container ${shortId}...`)
    // update the record
    this.save()
    // wait for logs to confirm that the genesis is done
    await waitUntilLogsSay(this.container, this.readyPhrase)
    // wait for port to be open
    await waitPort({ host: this.host, port: Number(this.port) })
    return this
  }

  load (): {
    containerId: string
    chainId:     string
    port:        number|string
  } | null {
    const data = super.load()
    if (data.containerId) {
      const id = data.containerId
      const Warnings = null
      const logs = () => { throw new Error(
        '@fadroma/ops/Devnet: tried to tail logs before creating container'
      ) }
      this.container = { id, Warnings, logs }
    } else {
      throw new Error('@fadroma/ops/Devnet: missing container id in devnet state')
    }
    return data
  }

  /** Write the state of the devnet to a file. */
  save () {
    return super.save({ containerId: this.container.id })
  }

  /** Spawn the existing localnet, or a new one if that is impossible */
  async respawn () {
    const shortPath = relative(config.projectRoot, this.nodeState.path)
    // if no node state, spawn
    if (!this.nodeState.exists()) {
      console.info(`No devnet found at ${bold(shortPath)}`)
      return this.spawn()
    }
    // get stored info about the container was supposed to be
    let id: string
    try {
      id = this.load().containerId
    } catch (e) {
      // if node state is corrupted, spawn
      console.warn(e)
      console.info(`Reading ${bold(shortPath)} failed`)
      return this.spawn()
    }
    // check if contract is running
    let running: boolean
    try {
      running = await this.isRunning(id)
    } catch (_e) {
      // if error when checking, RESPAWN
      //console.info(`✋ Failed to get container ${bold(id)}`)
      //console.info('Error was:', e)
      console.info(`Cleaning up outdated state...`)
      await this.erase()
      console.info(`Trying to launch a new node...`)
      return this.spawn()
    }
    // if not running, RESPAWN
    if (!running) this.startContainer(id)
    // ...and try to make sure it dies when the Node process dies
    process.on('beforeExit', () => {
      if (config.devnetEphemeral) {
        this.killContainer(id)
      } else {
        console.log()
        console.info(
          'Devnet is running on port', bold(String(this.port)),
          'from container', bold(this.container.id.slice(0,8))
        )
      }
    })
    return this
  }

  /** Kill the container, if necessary find it first */
  async kill () {
    if (this.container) {
      const { id } = this.container
      await this.killContainer(id)
      console.info(
        `Stopped container`, bold(id)
      )
    } else {
      console.info(
        `Checking if there's an old node that needs to be stopped...`
      )
      try {
        const { containerId } = this.load()
        await this.killContainer(containerId)
        console.info(`Stopped container ${bold(containerId)}.`)
      } catch (_e) {
        console.info("Didn't stop any container.")
      }
    }
  }

  /** External environment needs to be returned to a pristine state via Docker.
    * (Otherwise, root-owned dotdirs leak and have to be manually removed with sudo.) */
  async erase () {
    const path = bold(relative(cwd(), this.stateRoot.path))
    try {
      if (this.stateRoot.exists()) {
        console.info(`Deleting ${path}...`)
        this.stateRoot.delete()
      }
    } catch (e) {
      if (e.code === 'EACCES' || e.code === 'ENOTEMPTY') {
        console.warn(`Failed to delete ${path}: ${e.message}; trying cleanup container...`)
        await ensureDockerImage(this.image, this.docker)
        const container = await this.createContainer(getCleanupContainerOptions(this))
        console.info(`Starting cleanup container...`)
        await container.start()
        console.info('Waiting for cleanup to finish...')
        await container.wait()
        console.info(`Deleted ${path} via cleanup container.`)
      } else {
        console.warn(`Failed to delete ${path}: ${e.message}`)
        throw e
      }
    }
  }

  /** Used to command the container engine. */
  protected docker: Docker = new Docker({ sockerPath: '/var/run/docker.sock' })

  /** The created container */
  container: { id: string, Warnings: any, logs: Function }

  private isRunning = async (id: string = this.container.id) =>
    (await this.docker.getContainer(id).inspect()).State.Running

  private createContainer = async (options: any|Promise<any>) =>
    await this.docker.createContainer(await Promise.resolve(options))

  private startContainer = async (id: string = this.container.id) =>
    await this.docker.getContainer(id).start()

  private killContainer = async (id: string = this.container.id) => {
    const prettyId = bold(id.slice(0,8))
    if (await this.isRunning(id)) {
      console.info(`Stopping ${prettyId}...`)
      await this.docker.getContainer(id).kill()
      console.info(`Stopped ${prettyId}`)
    }
  }
}

/** What Dockerode passes to the Docker API
  * in order to launch a devnet container. */
export async function getDevnetContainerOptions ({
  chainId,
  genesisAccounts,
  image,
  initScript,
  port,
  stateRoot
}: DockerodeDevnet) {
  const initScriptName = resolve('/', basename(initScript))
  return {
    Image:        image,
    Name:         `${chainId}-${port}`,
    Env:          [ `Port=${port}`
                  , `ChainID=${chainId}`
                  , `GenesisAccounts=${genesisAccounts.join(' ')}` ],
    Entrypoint:   [ '/bin/bash' ],
    Cmd:          [ initScriptName ],
    Tty:          true,
    AttachStdin:  true,
    AttachStdout: true,
    AttachStderr: true,
    Hostname:     chainId,
    Domainname:   chainId,
    ExposedPorts: { [`${port}/tcp`]: {} },
    HostConfig:   { NetworkMode: 'bridge'
                  , AutoRemove:   true
                  , Binds:
                    [ `${initScript}:${initScriptName}:ro`
                    , `${stateRoot.path}:/receipts/${chainId}:rw` ]
                  , PortBindings:
                    { [`${port}/tcp`]: [{HostPort: `${port}`}] } }
  }
}

/** What Dockerode passes to the Docker API
  * in order to launch a cleanup container
  * (for removing root-owned devnet files
  * without escalating on the host) */
export async function getCleanupContainerOptions ({
  image,
  chainId,
  port,
  stateRoot
}: DockerodeDevnet) {
  return {
    AutoRemove: true,
    Image:      image,
    Name:       `${chainId}-${port}-cleanup`,
    Entrypoint: [ '/bin/rm' ],
    Cmd:        ['-rvf', '/state',],
    HostConfig: { Binds: [`${stateRoot.path}:/state:rw`] }
    //Tty: true, AttachStdin: true, AttachStdout: true, AttachStderr: true,
  }
}
