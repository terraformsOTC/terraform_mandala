import Header from '@/components/Header';
import { Footer } from '@/components/shared';

export const metadata = {
  title: 'Antenna Info',
  description:
    'How to enable antenna mode on a Terraforms parcel: upgrade to V2, enter daydream mode, then turn the antenna on (or off). A mirror of terraformsantenna.info with direct Etherscan links to each contract write function.',
  alternates: { canonical: 'https://terraformmandala.xyz/antenna' },
};

// Read-only mirror of terraformsantenna.info. Per this project's hard rule, the
// site never signs transactions — every action links to the exact Etherscan
// write function so the user executes it themselves. See CLAUDE.md / memory:
// "No transaction signing on Mandala site".
const TERRAFORMS = '0x4e1f41613c9084fdb9e34e11fae9412427480e56';
const ANTENNA = '0x331512a28a4cf80221af949b5d43041ff0fc7f01';

const etherscanWrite = (addr, fn) =>
  `https://etherscan.io/address/${addr}#writeContract#${fn}`;
const etherscanWriteProxy = (addr, fn) =>
  `https://etherscan.io/address/${addr}#writeProxyContract#${fn}`;

function EtherscanLink({ href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block btn-primary btn-sm text-sm no-underline whitespace-nowrap mt-1"
    >
      {children} ↗
    </a>
  );
}

function Step({ label, title, children }) {
  return (
    <section className="mt-10 pt-6 border-t border-current border-opacity-10">
      <div className="flex items-baseline gap-3 mb-2">
        <span className="text-xs opacity-60 uppercase tracking-wider">{label}</span>
        <h2 className="text-lg">{title}</h2>
      </div>
      <div className="text-sm opacity-75 leading-relaxed max-w-2xl flex flex-col gap-3">
        {children}
      </div>
    </section>
  );
}

export default function AntennaInfo() {
  return (
    <div className="content-wrapper">
      <Header />

      <main className="px-6 flex-1">
        <h1 className="text-2xl mb-4">antenna info</h1>
        <p className="text-sm opacity-75 leading-relaxed max-w-2xl">
          The mandala algorithms were designed to look best on Terraforms pointing to the newer
          V2 rendering contracts with antenna turned on. If your parcels are still on the old V0
          version, this guide will walk you through upgrading. It is essentially a backup of{' '}
          <a
            href="https://www.terraformsantenna.info/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            terraformsantenna.info
          </a>{' '}
          (source by{' '}
          <a
            href="https://github.com/imjameshall/terraformsantenna"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            imjameshall
          </a>
          ), kept here in case the original goes down. Unlike the original, this mirror never
          connects a wallet or signs transactions — each step links you to the exact Etherscan
          write function so you execute it yourself. Always independently verify a transaction
          before you sign it.
        </p>

        <Step label="Step 1" title="Upgrade to V2">
          <p>
            The first step is to move your parcel into V2 if it isn&apos;t pointing to the new
            contracts already.
          </p>
          <p>
            <span className="opacity-100">What is V2?</span> It is a reversible, opt-in upgrade
            that changes how Terraforms parcel animations are rendered. The difference is most
            obvious for parcels in daydream and terraform mode.
          </p>
          <ul className="list-none flex flex-col gap-1 pl-0">
            <li>
              <span className="opacity-100">V0:</span> Originally launched Terraform version.
            </li>
            <li>
              <span className="opacity-100">V1:</span> Terraforms version that will run off the EVM
              on its own in 50 years.
            </li>
            <li>
              <span className="opacity-100">V2:</span> The latest rendering contracts which include
              antenna mode.
            </li>
          </ul>
          <p>
            Call the upgrade write function on the Terraforms contract, passing your parcel IDs
            (comma separated). Contract:{' '}
            <code className="opacity-100 break-all">{TERRAFORMS}</code>
          </p>
          <EtherscanLink href={etherscanWrite(TERRAFORMS, 'F16')}>
            Terraforms contract · write #F16
          </EtherscanLink>
        </Step>

        <Step label="Step 2" title="Enter Daydream mode">
          <p>First, enter daydream mode for your parcel.</p>
          <p className="opacity-100" style={{ color: '#f87171' }}>
            Warning: this is irreversible!
          </p>
          <p>
            Call the daydream write function on the Terraforms contract, passing your parcel ID.
            Contract: <code className="opacity-100 break-all">{TERRAFORMS}</code>
          </p>
          <EtherscanLink href={etherscanWrite(TERRAFORMS, 'F6')}>
            Terraforms contract · write #F6
          </EtherscanLink>
        </Step>

        <Step label="Step 3" title="Turn the antenna ON">
          <p>Then turn the antenna on for your parcel.</p>
          <p>
            Call the antenna-on write function on the Terraforms Antenna proxy contract, passing
            your parcel ID. Contract: <code className="opacity-100 break-all">{ANTENNA}</code>
          </p>
          <EtherscanLink href={etherscanWriteProxy(ANTENNA, 'F20')}>
            Antenna proxy contract · write #F20
          </EtherscanLink>
        </Step>

        <Step label="Turn off" title="Turn the antenna OFF">
          <p>If you want to turn your antenna off, use this write function instead.</p>
          <p>
            Terraforms Antenna proxy contract:{' '}
            <code className="opacity-100 break-all">{ANTENNA}</code>
          </p>
          <EtherscanLink href={etherscanWriteProxy(ANTENNA, 'F19')}>
            Antenna proxy contract · write #F19
          </EtherscanLink>
        </Step>
      </main>

      <Footer />
    </div>
  );
}
