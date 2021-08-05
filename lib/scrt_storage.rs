use serde::Serialize;
use serde::de::DeserializeOwned;
pub use crate::{scrt::{ReadonlyStorage, StdResult, Storage, from_slice, to_vec}};

/// Save something to the storage.
#[inline]
pub fn save <T: Serialize, S: Storage> (
    storage: &mut S,
    key:     &[u8],
    value:   &T
) -> StdResult<()> {
    storage.set(key, &to_vec(value)?);
    Ok(())
}

/// Remove something from the storage.
#[inline]
pub fn remove <S: Storage> (
    storage: &mut S,
    key:     &[u8]
) {
    storage.remove(key);
}

/// Load something from the storage.
#[inline]
pub fn load <T: DeserializeOwned, S: ReadonlyStorage> (
    storage: &S,
    key:     &[u8]
) -> StdResult<Option<T>> {
    match storage.get(key) {
        Some(data) => from_slice(&data),
        None => Ok(None)
    }
}

/// Save something to the storage under a namespaced key.
#[inline]
pub fn ns_save <T: Serialize, S: Storage> (
    storage:   &mut S,
    namespace: &[u8],
    key:       &[u8],
    value:     &T
) -> StdResult<()> {
    storage.set(&concat(namespace, key), &to_vec(value)?);
    Ok(())
}

/// Remove the value of a namespaced key from the storage.
#[inline]
pub fn ns_remove <S: Storage> (
    storage:   &mut S,
    namespace: &[u8],
    key:       &[u8]
) {
    let key = concat(namespace, key);
    storage.remove(&key);
}

/// Load the value of a namespaced key.
#[inline]
pub fn ns_load <T: DeserializeOwned, S: ReadonlyStorage> (
    storage:   &S,
    namespace: &[u8],
    key:       &[u8]
) -> StdResult<Option<T>> {
    load(storage, &concat(namespace, key))
}

/// Concatenate a namespace and a key to get a namespaced key.
#[inline]
pub fn concat(
    namespace: &[u8],
    key:       &[u8]
) -> Vec<u8> {
    let mut k = namespace.to_vec();
    k.extend_from_slice(key);
    k
}

//#[macro_export] macro_rules! load {
    //($self:ident, $key:expr) => {
        //fadroma::scrt::storage::load(&$self.0, $key)
    //};
//}

//#[macro_export] macro_rules! save {
    //($self:ident, $key:expr, $val:expr) => {
        //$self.0.as_mut().set(&$key, &to_vec(&$val)?);
    //};
//}

//#[macro_export] macro_rules! ns_load {
    //($self:ident, $ns:expr, $key:expr) => {
        //fadroma::scrt::storage::ns_load(&$self.0, $ns, $key.as_slice())
    //};
//}

//#[macro_export] macro_rules! ns_save {
    //($self:ident, $ns:expr, $key:expr, $val:expr) => {
        //$self.0.as_mut().set(&concat($ns, $key.as_slice()), &to_vec(&$val)?)
    //}
//}
