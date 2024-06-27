import {
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  AccountLayout,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Account
} from '@solana/spl-token';
import {
  Connection,
  ParsedAccountData,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  TransactionInstruction,
} from '@solana/web3.js';
import { BN } from '@project-serum/anchor';

import { SEEDS, VAULT_BASE_KEY } from '../constants';
import { ParsedClockState, VaultProgram } from '../types';

type Optional<T> = T | null;

export const getAssociatedTokenAccount = async (tokenMint: PublicKey, owner: PublicKey) => {
  return await getAssociatedTokenAddress(tokenMint, owner, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
};

// export const deserializeAccount = (data: Buffer | undefined): Account | undefined => {
//   if (data == undefined || data.length == 0) {
//     return undefined;
//   }

//   const accountInfo = AccountLayout.decode(data);
//   accountInfo.mint = new PublicKey(accountInfo.mint);
//   accountInfo.owner = new PublicKey(accountInfo.owner);
//   accountInfo.amount = BigInt(accountInfo.amount.toString()); // use BigInt

//   if (accountInfo.delegateOption === 0) {
//     accountInfo.delegate = null;
//     accountInfo.delegatedAmount = BigInt(0);
//   } else {
//     accountInfo.delegate = new PublicKey(accountInfo.delegate);
//     accountInfo.delegatedAmount = BigInt(accountInfo.delegatedAmount.toString()); // use BigInt
//   }

//   accountInfo.isInitialized = accountInfo.state !== 0;
//   accountInfo.isFrozen = accountInfo.state === 2;

//   if (accountInfo.isNativeOption === 1) {
//     accountInfo.rentExemptReserve = BigInt(accountInfo.isNative.toString()); // use BigInt
//     accountInfo.isNative = true;
//   } else {
//     accountInfo.rentExemptReserve = null;
//     accountInfo.isNative = false;
//   }

//   if (accountInfo.closeAuthorityOption === 0) {
//     accountInfo.closeAuthority = null;
//   } else {
//     accountInfo.closeAuthority = new PublicKey(accountInfo.closeAuthority);
//   }

//   return accountInfo;
// };

export const getOrCreateATAInstruction = async (
  tokenMint: PublicKey,
  owner: PublicKey,
  connection: Connection,
  opt?: {
    payer?: PublicKey;
  },
): Promise<[PublicKey, TransactionInstruction?]> => {
  let toAccount;
  try {
    toAccount = await getAssociatedTokenAddress(tokenMint, owner, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const account = await connection.getAccountInfo(toAccount);
    if (!account) {
      const ix = createAssociatedTokenAccountInstruction(
        opt?.payer || owner,
        toAccount,
        owner,
        tokenMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      return [toAccount, ix];
    }
    return [toAccount, undefined];
  } catch (e) {
    /* handle error */
    console.error('Error::getOrCreateATAInstruction', e);
    throw e;
  }
};

export const getVaultPdas = (tokenMint: PublicKey, programId: PublicKey, seedBaseKey?: PublicKey) => {
  const [vault, _vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from(SEEDS.VAULT_PREFIX), tokenMint.toBuffer(), (seedBaseKey ?? VAULT_BASE_KEY).toBuffer()],
    programId,
  );

  const tokenVault = PublicKey.findProgramAddressSync(
    [Buffer.from(SEEDS.TOKEN_VAULT_PREFIX), vault.toBuffer()],
    programId,
  );
  const lpMint = PublicKey.findProgramAddressSync([Buffer.from(SEEDS.LP_MINT_PREFIX), vault.toBuffer()], programId);

  return {
    vaultPda: vault,
    tokenVaultPda: tokenVault[0],
    lpMintPda: lpMint[0],
  };
};

export const wrapSOLInstruction = (from: PublicKey, to: PublicKey, amount: BN): TransactionInstruction[] => {
  return [
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports: amount.toNumber(),
    }),
    new TransactionInstruction({
      keys: [
        {
          pubkey: to,
          isSigner: false,
          isWritable: true,
        },
      ],
      data: Buffer.from(new Uint8Array([17])),
      programId: TOKEN_PROGRAM_ID,
    }),
  ];
};

export const unwrapSOLInstruction = async (walletPublicKey: PublicKey) => {
  const wSolATAAccount = await getAssociatedTokenAddress(
    NATIVE_MINT,
    walletPublicKey,
  );

  if (wSolATAAccount) {
    const closedWrappedSolInstruction = createCloseAccountInstruction(
      wSolATAAccount,
      walletPublicKey,
      walletPublicKey,
      [],
    );
    return closedWrappedSolInstruction;
  }
  return null;
};

export const getOnchainTime = async (connection: Connection) => {
  const parsedClock = await connection.getParsedAccountInfo(SYSVAR_CLOCK_PUBKEY);

  const parsedClockAccount = (parsedClock.value!.data as ParsedAccountData).parsed as ParsedClockState;

  const currentTime = parsedClockAccount.info.unixTimestamp;
  return currentTime;
};

export const getLpSupply = async (connection: Connection, tokenMint: PublicKey): Promise<BN> => {
  const context = await connection.getTokenSupply(tokenMint);
  return new BN(context.value.amount);
};

export function chunks<T>(array: T[], size: number): T[][] {
  return Array.apply<number, T[], T[][]>(0, new Array(Math.ceil(array.length / size))).map((_, index) =>
    array.slice(index * size, (index + 1) * size),
  );
}

export async function chunkedFetchMultipleVaultAccount(
  program: VaultProgram,
  pks: PublicKey[],
  chunkSize: number = 100,
) {
  const accounts = (
    await Promise.all(chunks(pks, chunkSize).map((chunk) => program.account.vault.fetchMultiple(chunk)))
  ).flat();

  return accounts.filter(Boolean);
}

export async function chunkedGetMultipleAccountInfos(
  connection: Connection,
  pks: PublicKey[],
  chunkSize: number = 100,
) {
  const accountInfos = (
    await Promise.all(chunks(pks, chunkSize).map((chunk) => connection.getMultipleAccountsInfo(chunk)))
  ).flat();

  return accountInfos;
}
