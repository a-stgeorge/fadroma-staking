/** Extend SecretNetworkContract class
 * with methods automatically generated
 * from provided JSON schema. */
export default function extendWithSchema (
  SecretNetworkContract,
  { queryMsg, handleMsg }
) {

  return class SecretNetworkContractWithSchema extends SecretNetworkContract {

    /* Returns a function binding the executing agent
     * to a collection of possible queries */
    get q () {
      return (agent = this.agent) =>
        methodsFromSchema(this, queryMsg, (instance, method) => ({
          async [method] (args) {
            return await instance.query(method, args, agent)
          }
        }))
    }

    /* Returns a function binding the executing agent
     * to a collection of possible transactions */
    get tx () {
      return (agent = this.agent) =>
        methodsFromSchema(
          this, handleMsg, (instance, method) => ({
            async [method] (args) {
              return await instance.execute(method, args, agent)
            }
          }))
    }

  }

  // TODO: memoize this, so that methods aren't regenerated until the schema updates
  // TODO: generate TypeScript types from autogenerated method lists and/or from schema
  function methodsFromSchema (instance, messages, getWrappedMethod) {
    if (!messages) return null
    return messages.anyOf.reduce((methods, methodSchema)=>{
      const {description, required:[methodName]} = methodSchema
      const methodWrapper = getWrappedMethod(instance, methodName)
      methodWrapper[methodName].description = description
      methodWrapper[methodName] = methodWrapper[methodName].bind(instance)
      return Object.assign(methods, methodWrapper)
    }, {})
  }

}
