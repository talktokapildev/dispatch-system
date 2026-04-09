'use client'
import { useState } from 'react'
import { SectionHeader } from '@/components/ui'
import { Settings, Bell, Shield, PoundSterling, Car } from 'lucide-react'
import toast from 'react-hot-toast'

const SECTIONS = ['General', 'Pricing', 'Dispatch', 'Notifications', 'Compliance']

export default function SettingsPage() {
  const [active, setActive] = useState('General')
  const [saved, setSaved] = useState(false)

  const save = () => {
    toast.success('Settings saved')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader title="Settings" subtitle="System configuration and preferences" />

      <div className="flex gap-5">
        {/* Side nav */}
        <div className="w-44 shrink-0 space-y-0.5">
          {SECTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setActive(s)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                active === s ? 'bg-brand-500/10 text-brand-400' : 'text-slate-400 hover:text-white hover:bg-[var(--table-hover)]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 card p-6 space-y-6">
          {active === 'General' && (
            <>
              <h2 className="text-sm font-semibold text-white border-b border-[var(--border)] pb-3">General Settings</h2>
              <div className="space-y-4">
                {[
                  { label: 'Company Name', value: 'Your Company Ltd', key: 'companyName' },
                  { label: 'TfL Operator Licence Number', value: 'PHV1234567', key: 'licenseNumber' },
                  { label: 'Contact Email', value: 'dispatch@company.com', key: 'email' },
                  { label: 'Contact Phone', value: '+44 20 1234 5678', key: 'phone' },
                  { label: 'Business Address', value: 'London, UK', key: 'address' },
                ].map(({ label, value, key }) => (
                  <div key={key}>
                    <label className="text-xs text-slate-400 block mb-1.5">{label}</label>
                    <input defaultValue={value} className="input max-w-md" />
                  </div>
                ))}
              </div>
            </>
          )}

          {active === 'Pricing' && (
            <>
              <h2 className="text-sm font-semibold text-white border-b border-[var(--border)] pb-3">Pricing Configuration</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 max-w-lg">
                  {[
                    { label: 'Platform Fee (%)', value: '15', key: 'platformFee' },
                    { label: 'Minimum Fare (£)', value: '5.00', key: 'minFare' },
                    { label: 'Night Rate Premium (%)', value: '20', key: 'nightRate' },
                    { label: 'Weekend Premium (%)', value: '10', key: 'weekendRate' },
                    { label: 'Bank Holiday Premium (%)', value: '25', key: 'bankHoliday' },
                    { label: 'Airport Pickup Supplement (£)', value: '5.00', key: 'airportPickup' },
                  ].map(({ label, value, key }) => (
                    <div key={key}>
                      <label className="text-xs text-slate-400 block mb-1.5">{label}</label>
                      <input defaultValue={value} type="number" step="0.01" className="input" />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-600">These are default values. Per-vehicle-class rates are managed in the pricing zones table.</p>
              </div>
            </>
          )}

          {active === 'Dispatch' && (
            <>
              <h2 className="text-sm font-semibold text-white border-b border-[var(--border)] pb-3">Dispatch Engine</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 max-w-lg">
                  {[
                    { label: 'Driver Accept Timeout (seconds)', value: '60', key: 'acceptTimeout' },
                    { label: 'Max Dispatch Attempts', value: '3', key: 'maxAttempts' },
                    { label: 'Max Search Radius (km)', value: '10', key: 'searchRadius' },
                    { label: 'Pre-book Lead Time (minutes)', value: '30', key: 'leadTime' },
                  ].map(({ label, value, key }) => (
                    <div key={key}>
                      <label className="text-xs text-slate-400 block mb-1.5">{label}</label>
                      <input defaultValue={value} type="number" className="input" />
                    </div>
                  ))}
                </div>

                <div className="space-y-3 pt-2">
                  {[
                    { label: 'Auto-dispatch ASAP jobs', description: 'Automatically offer ASAP jobs to nearest available driver', defaultChecked: true },
                    { label: 'Escalate to manual after max attempts', description: 'Alert dispatcher if no driver accepts within configured attempts', defaultChecked: true },
                    { label: 'Allow driver to reject jobs', description: 'Drivers can decline job offers (recommended)', defaultChecked: true },
                  ].map(({ label, description, defaultChecked }) => (
                    <label key={label} className="flex items-start gap-3 cursor-pointer group">
                      <input type="checkbox" defaultChecked={defaultChecked} className="mt-0.5 accent-brand-500" />
                      <div>
                        <p className="text-xs text-white group-hover:text-brand-400 transition-colors">{label}</p>
                        <p className="text-[11px] text-slate-600 mt-0.5">{description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {active === 'Notifications' && (
            <>
              <h2 className="text-sm font-semibold text-white border-b border-[var(--border)] pb-3">Notification Settings</h2>
              <div className="space-y-3">
                {[
                  { label: 'New booking created', channels: ['Push', 'Email'] },
                  { label: 'Driver assigned', channels: ['Push', 'SMS'] },
                  { label: 'Driver arrived', channels: ['Push', 'SMS'] },
                  { label: 'Trip completed', channels: ['Push', 'Email'] },
                  { label: 'Booking cancelled', channels: ['Push', 'Email'] },
                  { label: 'Document expiry alert', channels: ['Email'] },
                  { label: 'Manual dispatch required', channels: ['Push', 'Email'] },
                ].map(({ label, channels }) => (
                  <div key={label} className="flex items-center justify-between py-2 border-b border-[var(--border)]">
                    <p className="text-xs text-slate-300">{label}</p>
                    <div className="flex gap-2">
                      {['Push', 'SMS', 'Email'].map((c) => (
                        <label key={c} className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" defaultChecked={channels.includes(c)} className="accent-brand-500" />
                          <span className="text-[11px] text-slate-500">{c}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {active === 'Compliance' && (
            <>
              <h2 className="text-sm font-semibold text-white border-b border-[var(--border)] pb-3">TfL Compliance Settings</h2>
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
                  These settings appear on all passenger receipts and are legally required under your TfL operator licence.
                </div>
                {[
                  { label: 'Operator Licence Number', value: 'PHV1234567' },
                  { label: 'Operator Name (as licensed)', value: 'Your Company Ltd' },
                  { label: 'Registered Address', value: 'London, UK' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <label className="text-xs text-slate-400 block mb-1.5">{label}</label>
                    <input defaultValue={value} className="input max-w-md" />
                  </div>
                ))}
                <div className="space-y-3 pt-2">
                  {[
                    { label: 'Alert when PCO licence expires within 60 days', defaultChecked: true },
                    { label: 'Alert when vehicle MOT expires within 30 days', defaultChecked: true },
                    { label: 'Alert when vehicle insurance expires within 30 days', defaultChecked: true },
                    { label: 'Block driver from receiving jobs if documents expired', defaultChecked: true },
                    { label: 'Include driver PCO badge on passenger receipts', defaultChecked: true },
                  ].map(({ label, defaultChecked }) => (
                    <label key={label} className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" defaultChecked={defaultChecked} className="accent-brand-500" />
                      <span className="text-xs text-slate-300">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="pt-4 border-t border-[var(--border)]">
            <button onClick={save} className="btn-primary">
              {saved ? '✓ Saved' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
