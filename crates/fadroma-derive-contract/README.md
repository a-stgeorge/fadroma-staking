<div align="center">
<table><tr><td valign="middle" style="vertical-align:bottom">

[<img src="https://github.com/hackbg/fadroma/raw/22.01/doc/logo.svg" width="300">](https://fadroma.tech)

</td><td valign="center">

# Fadroma Derive Contract ![](https://img.shields.io/badge/version-0.1.0-blueviolet)

**This document describes how to write boilerplate-free CosmWasm smart contracts using a `derive-contract` procedural macro.**

Made with [💚](mailto:hello@hack.bg) at [Hack.bg](https://hack.bg).

</td></tr></table>

</div>

## Introduction
Derive contract macro takes care of all necessary boilerplate in CosmWasm smart contracts and provides a more productive development experience.

## Getting started
Derive macro can be used for direct contract implementations with `#[contract(entry)]` or for contracts that implement **interfaces** with `#[contract_impl(entry, path="some_interface")]`.
An interface implementation should be used over direct implementations if there's any intercontract communication, this allows to include messages of other contracts without any cyclical dependencies as those messages are exported by the interface.

### **Attributes**
The derive-contract macro supports the following attributes:  
| Attribute         | Description                                                                                                    |
|-------------------|----------------------------------------------------------------------------------------------------------------|
| **init**          | `init` method of the contract                                                                                  |
| **handle**        | `handle` method of the contract                                                                                |
| **query**         | `query` method of the contract                                                                                 |
| **handle_guard**  | Handler for fadroma's Killswitch                                                                               |
| **component**     | Used to include an interface                                                                                   |
| **entry**         | Signals that WASM entry points should be generated for the current contract                                    |
| **path**          | Specifies a path to a type or a namespace                                                                      |
| **skip**          | Used to not include a handle/query of the component                                                            |
| **custom_impl**   | Used to provide a custom implementation of a component instead of using the auto generated default trait impl  |

### **Usage**
#### **Without an interface**
```rust
// contract.rs
#[contract(entry)]
pub trait Contract {
    #[init]
    pub fn new(config: Config) -> StdResult<InitResponse> {
        -- snip --
    }

    #[handle]
    pub fn set_config(config: Config) -> StdResult<HandleResponse> {
        -- snip --
    }

    #[query]
    pub fn get_config(config: Config) -> StdResult<ConfigResponse> {
        -- snip --
    }
}
```
This code will generate the necessary entry points and messages, that are exported by the contract, in accordance to the attributes like so:
```rust
pub struct InitMsg {
    pub config: Config
}

pub enum HandleMsg {
    SetConfig { config: Config }
}

pub enum QueryMsg {
    GetConfig {}
}

```

#### **With an interface**
```rust
// shared/interfaces/contract.rs
#[interface]
pub trait Contract {
    #[init]
    pub fn new(config: Config) -> StdResult<InitResponse>;

    #[handle]
    pub fn set_config(config: Config) -> StdResult<HandleResponse>;

    #[query]
    pub fn get_config() -> StdResult<ConfigResponse>;
}

// contracts/contract.rs
#[contract_impl(entry, path="shared::interfaces::contract")]
pub trait Contract {
    #[init]
    pub fn new(config: Config) -> StdResult<InitResponse> {
        -- snip --
    }

    #[handle]
    pub fn set_config(config: Config) -> StdResult<HandleResponse> {
        -- snip --
    }

    #[query]
    pub fn get_config() -> StdResult<ConfigResponse> {
        -- snip --
    }
}

// some other contract
// contracts/other_contract.rs
use shared::interfaces::contract::{HandleMsg, QueryMsg};
-- snip --
```
This code will generate the necessary entry points and messages, but now they are exported by the interface module and can be used for intercontract communication.

#### **Multiple components**
Multiple components can be used in a single contract like so
```rust
#[contract_impl(
    entry,
    path = "shared::interfaces::contract",
    component(path = "admin"),
    component(path = "killswitch")
)]
```

#### **Testing**
Contracts can be tested using `fadroma-ensemble`, which allows overriding default contract implementations for test purposes, calls betweens contracts etc.
```rust
// use contract crate
use consumer;

pub struct Consumer;

// Example test for an oracle consumer contract
impl ContractHarness for Consumer {
    // Use the method from the default implementation 
    fn init(&self, deps: &mut MockDeps, env: Env, msg: Binary) -> StdResult<InitResponse> {
        Contract::init(deps, env, from_binary(&msg)?, consumer::DefaultImpl)
    }
       
    fn handle(
        &self,
        deps: &mut MockDeps,
        env: Env,
        msg: Binary,
    ) -> StdResult<HandleResponse> {
        Contract::handle(deps, env, from_binary(&msg)?, consumer::DefaultImpl)
    }
    // Override with some hardcoded value for the ease of testing
    fn query(&self, deps: &MockDeps, msg: Binary) -> StdResult<Binary> {
        let msg = from_binary(&msg).unwrap();
        match msg {
            OracleQuery::GetPrice { base_symbol, .. } => {
                to_binary(Uint128(1_000_000_000))
            }
        }
    }
}

pub struct Project {
    pub ensemble: ContractEnsemble,
    pub consumer: ContractLink<HumanAddr>,
}

impl Project {
    pub fn new() -> Self {
        let mut ensemble = ContractEnsemble::new(50);

        let consumer = ensemble.register(Box::new(Consumer));

        let consumer = ensemble.instantiate(consumer.id,
        &{},
        MockEnv::new(
            ADMIN,
            ContractLink {
                address: "consumer".into(),
                code_hash: consumer.code_hash,
            }
        ))

        Self {
            ensemble,
            consumer,
        }
    }
}

#[test]
fn get_oracle_price() {
    let mut project = new Project();

    let price: Uint128 = project.ensemble.query(
        consumer.address, 
        &consumer::QueryMsg::GetPrice {base_symbol: "SCRT"}
    ).unwrap();

    assert_eq!(price, Uint128(1_000_000_000));
}
```