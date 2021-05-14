/** Builds contracts and optionally uploads them as an agent on the Secret Network.
 * Stores upload results as receipts.
 */
export class SecretNetworkBuilder {
  constructor (fields) { this.configure(fields) }
  configure = (fields={}) => { Object.assign(this, fields) }
  get address () { return this.agent ? this.agent.address : undefined }
  /** Build from source in a Docker container.
   */
  async build (options) {
    const docker       = new Docker()
    const buildImage   = await pull('enigmampc/secret-contract-optimizer:latest', docker)
    const buildCommand = this.getBuildCommand(options)
    const entrypoint   = resolve(__dirname, 'build.sh')
    const buildOptions = {
      Env: this.getBuildEnv(),
      Tty: true,
      AttachStdin: true,
      Entrypoint: ['/bin/sh', '-c'],
      HostConfig: {
        Binds: [
          `${entrypoint}:/entrypoint.sh:ro`,
          `${options.outputDir}:/output:rw`,
          `sienna_cache_${options.ref||'HEAD'}:/code/target:rw`,
          `cargo_cache_${options.ref||'HEAD'}:/usr/local/cargo:rw`,
        ]
      }
    }
    options.ref = options.ref || 'HEAD'
    if (options.ref === 'HEAD') { // when building working tree
      debug(`building working tree at ${options.workspace} into ${options.outputDir}...`)
      buildOptions.HostConfig.Binds.push(`${options.workspace}:/contract:rw`)
    }
    const args = [buildImage, buildCommand, process.stdout, buildOptions]
    const [{Error:err, StatusCode:code}, container] = await docker.run(...args)
    await container.remove()
    if (err) throw new Error(err)
    if (code !== 0) throw new Error(`build exited with status ${code}`)
    return resolve(options.outputDir, `${options.crate}@${options.ref}.wasm`)
  }
  /** Generate the command line for the container.
   */
  getBuildCommand ({
    buildAs = 'root',
    origin  = 'git@github.com:hackbg/sienna-secret-token.git',
    ref     = 'HEAD',
    crate,
  }) {
    const commands = []
    if (ref !== 'HEAD') {
      assert(origin && ref, 'to build a ref from origin, specify both')
      debug('building ref from origin...')
      commands.push('mkdir -p /contract')
      commands.push('cd /contract')
      commands.push(`git clone --recursive -n ${origin} .`) // clone the repo with submodules
      commands.push(`git checkout ${ref}`) // check out the interesting ref
      commands.push(`git submodule update`) // update submodules for the new checkout
      //commands.push(`chown -R ${buildAs} /contract`)
    }
    commands.push(`bash /entrypoint.sh ${crate} ${ref||''}`)
    //commands.push(`pwd && ls -al && mv ${crate}.wasm /output/${crate}@${ref}.wasm`)
    return commands.join(' && ')
  }
  /** Get environment variables for the container.
   */
  getBuildEnv = () =>
    [ 'CARGO_NET_GIT_FETCH_WITH_CLI=true'
    , 'CARGO_TERM_VERBOSE=true'
    , 'CARGO_HTTP_TIMEOUT=240' ]
  /** Try to upload a binary to the network but return a pre-existing receipt if one exists.
   *  TODO also code checksums should be validated
   */
  async uploadCached (artifact) {
    const receiptPath = this.getReceiptPath(artifact)
    if (existsSync(receiptPath)) {
      const receiptData = await readFile(receiptPath, 'utf8')
      info(`${receiptPath} exists. Delete it to reupload that contract.`)
      return JSON.parse(receiptData)
    } else {
      return this.upload(artifact)
    }
  }
  getReceiptPath = path =>
    resolve(this.network.receipts, `${basename(path)}.upload.json`)
  /** Upload a binary to the network.
   */
  async upload (artifact) {
    const uploadResult = await this.agent.upload(artifact)
    const receiptData  = JSON.stringify(uploadResult, null, 2)
    await writeFile(this.getReceiptPath(artifact), receiptData, 'utf8')
    return uploadResult
  }
}