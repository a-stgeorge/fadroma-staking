/* tslint:disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

export type QueryMsg =
  | {
      token_info: {
        [k: string]: unknown;
      };
      [k: string]: unknown;
    }
  | {
      contract_status: {
        [k: string]: unknown;
      };
      [k: string]: unknown;
    }
  | {
      exchange_rate: {
        [k: string]: unknown;
      };
      [k: string]: unknown;
    }
  | {
      allowance: {
        key: string;
        owner: HumanAddr;
        spender: HumanAddr;
        [k: string]: unknown;
      };
      [k: string]: unknown;
    }
  | {
      balance: {
        address: HumanAddr;
        key: string;
        [k: string]: unknown;
      };
      [k: string]: unknown;
    }
  | {
      transfer_history: {
        address: HumanAddr;
        key: string;
        page?: number | null;
        page_size: number;
        [k: string]: unknown;
      };
      [k: string]: unknown;
    }
  | {
      transaction_history: {
        address: HumanAddr;
        key: string;
        page?: number | null;
        page_size: number;
        [k: string]: unknown;
      };
      [k: string]: unknown;
    }
  | {
      minters: {
        [k: string]: unknown;
      };
      [k: string]: unknown;
    };
export type HumanAddr = string;