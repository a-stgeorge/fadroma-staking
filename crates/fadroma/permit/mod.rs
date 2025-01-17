//! *Feature flag: `permit`*
//! Authentication using SNIP-24 query permits.

use crate::prelude::*;
use serde::{Deserialize, Serialize};

#[cfg(target_arch = "wasm32")] use fadroma_platform_scrt::cosmwasm_std::CanonicalAddr;
#[cfg(target_arch = "wasm32")] use ripemd160::{Digest, Ripemd160};
#[cfg(target_arch = "wasm32")] use secp256k1::Secp256k1;
#[cfg(target_arch = "wasm32")] use sha2::Sha256;

pub trait Permission: Serialize + JsonSchema + Clone + PartialEq { }

impl<T: Serialize + JsonSchema + Clone + PartialEq> Permission for T { }

#[cfg(target_arch = "wasm32")]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct Permit<P: Permission> {
    pub params: PermitParams<P>,
    pub signature: PermitSignature
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct Permit<P: Permission> {
    pub params: PermitParams<P>,
    pub address: HumanAddr
}

#[cfg(not(target_arch = "wasm32"))]
impl<P: Permission> Permit<P> {
    pub fn new(
        address: impl Into<HumanAddr>,
        permissions: Vec<P>,
        allowed_tokens: Vec<HumanAddr>,
        permit_name: impl Into<String>
    ) -> Self {
        Self {
            params: PermitParams {
                permissions,
                permit_name: permit_name.into(),
                allowed_tokens,
                chain_id: "cosmos-testnet-14002".into()
            },
            address: address.into()
        }
    }
}

impl<P: Permission> Permit<P> {
    const NS_PERMITS: &'static [u8] = b"GAl8kO8Z8w";

    #[inline]
    pub fn check_token(&self, token: &HumanAddr) -> bool {
        self.params.allowed_tokens.contains(token)
    }

    #[inline]
    pub fn check_permission(&self, permission: &P) -> bool {
        self.params.permissions.contains(permission)
    }

    pub fn validate_with_permissions<S: Storage, A: Api, Q: Querier>(
        &self,
        deps: &Extern<S, A, Q>,
        current_contract_addr: HumanAddr,
        expected_permissions: Vec<P>
    ) -> StdResult<HumanAddr> {
        if !expected_permissions.iter().all(|x| self.check_permission(x)) {
            return Err(StdError::generic_err(format!(
                "Expected permission(s): {}, got: {}",
                Self::print_permissions(&expected_permissions)?,
                Self::print_permissions(&self.params.permissions)?
            )));
        }

        self.validate(deps, current_contract_addr)
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn validate<S: Storage, A: Api, Q: Querier>(
        &self,
        deps: &Extern<S, A, Q>,
        current_contract_addr: HumanAddr
    ) -> StdResult<HumanAddr> {
        if !self.check_token(&current_contract_addr) {
            return Err(StdError::generic_err(self.check_token_err(current_contract_addr)));
        }
    
        Self::assert_not_revoked(&deps.storage, &self.address, &self.params.permit_name)?;

        Ok(self.address.clone())
    }

    #[cfg(target_arch = "wasm32")]
    pub fn validate<S: Storage, A: Api, Q: Querier>(
        &self,
        deps: &Extern<S, A, Q>,
        current_contract_addr: HumanAddr
    ) -> StdResult<HumanAddr> {
        if !self.check_token(&current_contract_addr) {
            return Err(StdError::generic_err(self.check_token_err(current_contract_addr)));
        }
    
        // Derive account from pubkey
        let pubkey = &self.signature.pub_key.value;
        let account = deps.api.human_address(&self.pubkey_to_account(pubkey))?;
    
        Self::assert_not_revoked(&deps.storage, &account, &self.params.permit_name)?;
    
        // Validate signature, reference: https://github.com/enigmampc/SecretNetwork/blob/f591ed0cb3af28608df3bf19d6cfb733cca48100/cosmwasm/packages/wasmi-runtime/src/crypto/secp256k1.rs#L49-L82
        let signed_bytes = to_binary(&SignedPermit::from_params(&self.params))?;
        let signed_bytes_hash = Sha256::digest(signed_bytes.as_slice());
    
        let secp256k1_msg =
            secp256k1::Message::from_slice(signed_bytes_hash.as_slice()).map_err(|err| {
                StdError::generic_err(format!(
                    "Failed to create a secp256k1 message from signed_bytes: {:?}",
                    err
                ))
            })?;
    
        let secp256k1_verifier = Secp256k1::verification_only();
    
        let secp256k1_signature = secp256k1::Signature::from_compact(&self.signature.signature.0)
            .map_err(|err| StdError::generic_err(format!("Malformed signature: {:?}", err)))?;
    
        let secp256k1_pubkey = secp256k1::PublicKey::from_slice(pubkey.0.as_slice())
            .map_err(|err| StdError::generic_err(format!("Malformed pubkey: {:?}", err)))?;
    
        secp256k1_verifier
            .verify(&secp256k1_msg, &secp256k1_signature, &secp256k1_pubkey)
            .map_err(|err| {
                StdError::generic_err(format!(
                    "Failed to verify signatures for the given permit: {:?}",
                    err
                ))
            })?;
    
        Ok(account)
    }

    pub fn assert_not_revoked(
        storage: &impl Storage,
        account: &HumanAddr,
        permit_name: &str
    ) -> StdResult<()> {
        let key = [ Self::NS_PERMITS, account.0.as_bytes(), permit_name.as_bytes() ].concat();
    
        if storage.get(&key).is_some() {
            return Err(StdError::generic_err(format!(
                "Permit {:?} was revoked by account {:?}",
                permit_name,
                account.as_str()
            )));
        }

        Ok(())
    }
    
    pub fn revoke(
        storage: &mut impl Storage,
        account: &HumanAddr,
        permit_name: &str
    ) {
        let key = [ Self::NS_PERMITS, account.0.as_bytes(), permit_name.as_bytes() ].concat();
    
        storage.set(&key, &[])
    }

    pub fn print_permissions(permissions: &Vec<P>) -> StdResult<String> {
        let mut result = Vec::with_capacity(permissions.len());

        for permission in permissions {
            let bin = to_binary(&permission)?;
            let string = String::from_utf8(bin.0);

            match string {
                Ok(string) => result.push(string),
                Err(err) => return Err(StdError::generic_err(err.to_string()))
            }
        }

        Ok(result.join(", "))
    }

    fn check_token_err(&self, current_contract_addr: HumanAddr) -> String {
        format!(
            "Permit doesn't apply to contract {}, allowed contracts: {}",
            current_contract_addr.0,
            self
                .params
                .allowed_tokens
                .iter()
                .map(|a| a.0.as_str())
                .collect::<Vec<&str>>()
                .join(", ")
        )
    }

    #[cfg(target_arch = "wasm32")]
    fn pubkey_to_account(&self, pubkey: &Binary) -> CanonicalAddr {
        let mut hasher = Ripemd160::new();
        hasher.update(Sha256::digest(&pubkey.0));
        CanonicalAddr(Binary(hasher.finalize().to_vec()))
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub struct PermitParams<P: Permission> {
    pub allowed_tokens: Vec<HumanAddr>,
    pub permit_name: String,
    pub chain_id: String,
    pub permissions: Vec<P>
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub struct PermitSignature {
    pub pub_key: PubKey,
    pub signature: Binary
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub struct PubKey {
    /// ignored, but must be "tendermint/PubKeySecp256k1" otherwise the verification will fail
    pub r#type: String,
    /// Secp256k1 PubKey
    pub value: Binary
}

// Note: The order of fields in this struct is important for the permit signature verification!
#[remain::sorted]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub struct SignedPermit<P: Permission> {
    /// ignored
    pub account_number: Uint128,
    /// ignored, no Env in query
    pub chain_id: String,
    /// ignored
    pub fee: Fee,
    /// ignored
    pub memo: String,
    /// the signed message
    pub msgs: Vec<PermitMsg<P>>,
    /// ignored
    pub sequence: Uint128
}

impl<P: Permission> SignedPermit<P> {
    pub fn from_params(params: &PermitParams<P>) -> Self {
        Self {
            account_number: Uint128::zero(),
            chain_id: params.chain_id.clone(),
            fee: Fee::new(),
            memo: String::new(),
            msgs: vec![PermitMsg::from_content(PermitContent::from_params(params))],
            sequence: Uint128::zero(),
        }
    }
}

// Note: The order of fields in this struct is important for the permit signature verification!
#[remain::sorted]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub struct Fee {
    pub amount: Vec<Coin>,
    pub gas: Uint128
}

impl Fee {
    pub fn new() -> Self {
        Self {
            amount: vec![Coin::new()],
            gas: Uint128(1)
        }
    }
}

// Note: The order of fields in this struct is important for the permit signature verification!
#[remain::sorted]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub struct Coin {
    pub amount: Uint128,
    pub denom: String
}

impl Coin {
    pub fn new() -> Self {
        Self {
            amount: Uint128::zero(),
            denom: "uscrt".to_string()
        }
    }
}

// Note: The order of fields in this struct is important for the permit signature verification!
#[remain::sorted]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub struct PermitMsg<P: Permission> {
    pub r#type: String,
    pub value: PermitContent<P>
}

impl<P: Permission> PermitMsg<P> {
    pub fn from_content(content: PermitContent<P>) -> Self {
        Self {
            r#type: "query_permit".to_string(),
            value: content
        }
    }
}

// Note: The order of fields in this struct is important for the permit signature verification!
#[remain::sorted]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub struct PermitContent<P: Permission> {
    pub allowed_tokens: Vec<HumanAddr>,
    pub permissions: Vec<P>,
    pub permit_name: String
}

impl<P: Permission> PermitContent<P> {
    pub fn from_params(params: &PermitParams<P>) -> Self {
        Self {
            allowed_tokens: params.allowed_tokens.clone(),
            permit_name: params.permit_name.clone(),
            permissions: params.permissions.clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fadroma_platform_scrt::cosmwasm_std::testing::mock_dependencies;

    #[test]
    fn test_permission() {
        #[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
        #[serde(rename_all = "snake_case")]
        #[serde(deny_unknown_fields)]
        enum Permission {
            One,
            Two
        }

        let ref mut deps = mock_dependencies(20, &[]);

        let contract_addr = HumanAddr::from("contract");
        let permissions = vec![ Permission::One ];
        let sender = HumanAddr::from("sender");

        let permit = Permit::new(
            sender.clone(),
            permissions.clone(),
            vec![ contract_addr.clone() ],
            "permit"
        );

        let wrong_contract = HumanAddr::from("wrong_contract");
        let err = permit.validate_with_permissions(
            deps,
            wrong_contract.clone(),
            permissions.clone()
        ).unwrap_err();

        match err {
            StdError::GenericErr { msg, .. } => {
                assert_eq!(msg, format!(
                    "Permit doesn't apply to contract {}, allowed contracts: {}",
                    wrong_contract.0.as_str(),
                    contract_addr.0.as_str()
                ))
            },
            _ => panic!("Expected StdError::GenericErr")
        }

        let expected_permissions = vec![ Permission::One, Permission::Two ];
        let err = permit.validate_with_permissions(
            deps,
            contract_addr.clone(),
            expected_permissions.clone()
        ).unwrap_err();

        match err {
            StdError::GenericErr { msg, .. } => {
                assert_eq!(msg, format!(
                    "Expected permission(s): {}, got: {}",
                    Permit::print_permissions(&expected_permissions).unwrap(),
                    Permit::print_permissions(&permissions).unwrap()
                ))
            },
            _ => panic!("Expected StdError::GenericErr")
        }

        let result = permit.validate_with_permissions(
            deps,
            contract_addr,
            permissions.clone()
        ).unwrap();

        assert_eq!(result, sender);
    }
}

