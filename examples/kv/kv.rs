use fadroma::{
    schemars,
    cosmwasm_std::{
        Storage, Api, Querier, Extern, Env,  StdError,
        InitResponse, HandleResponse, Binary, StdResult,
        to_binary
    },
    prelude::*
};

const KEY: &'static [u8] = b"value";

#[derive(serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct InitMsg { value: Option<String> }
pub fn init<S: Storage, A: Api, Q: Querier>(
    deps: &mut Extern<S, A, Q>, _env: Env, msg: InitMsg,
) -> StdResult<InitResponse> {
    if let Some(value) = msg.value {
        save(&mut deps.storage, KEY, &value)?;
    }
    Ok(InitResponse::default())
}

#[derive(serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub enum HandleMsg { Set(String), Del }
pub fn handle<S: Storage, A: Api, Q: Querier>(
    deps: &mut Extern<S, A, Q>, _env: Env, msg: HandleMsg,
) -> StdResult<HandleResponse> {
    match msg {
        HandleMsg::Set(value) => {
            save(&mut deps.storage, KEY, &value)?
        },
        HandleMsg::Del => {
            remove(&mut deps.storage, KEY)
        }
    };
    Ok(HandleResponse::default())
}

#[derive(serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub enum QueryMsg { Get }
pub fn query<S: Storage, A: Api, Q: Querier>(
    deps: &Extern<S, A, Q>, msg: QueryMsg,
) -> StdResult<Binary> {
    match msg {
        QueryMsg::Get => if let Some(value) = load::<String, S>(&deps.storage, KEY)? {
            to_binary(&value)
        } else {
            Err(StdError::generic_err("empty"))
        }
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use fadroma::cosmwasm_std::{
        do_handle, do_init, do_query, ExternalApi, ExternalQuerier, ExternalStorage,
    };
    #[no_mangle]
    extern "C" fn init(env_ptr: u32, msg_ptr: u32) -> u32 {
        do_init(&super::init::<ExternalStorage, ExternalApi, ExternalQuerier>, env_ptr, msg_ptr)
    }
    #[no_mangle]
    extern "C" fn handle(env_ptr: u32, msg_ptr: u32) -> u32 {
        do_handle(&super::handle::<ExternalStorage, ExternalApi, ExternalQuerier>, env_ptr, msg_ptr)
    }
    #[no_mangle]
    extern "C" fn query(msg_ptr: u32) -> u32 {
        do_query(&super::query::<ExternalStorage, ExternalApi, ExternalQuerier>, msg_ptr)
    }
}
