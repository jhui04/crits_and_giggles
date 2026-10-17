import { useCampaigns } from '../context/CampaignContext';

const ADD_NEW_VALUE = '__add_new_campaign__';

interface CampaignPickerProps {
  id: string;
  onAddNew: () => void;
}

/** Combo box to switch campaigns; its last option opens the New Campaign dialog. */
export function CampaignPicker({ id, onAddNew }: CampaignPickerProps) {
  const { campaigns, activeCampaign, setActiveCampaignId } = useCampaigns();

  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', fontWeight: 'bold' }}>Campaign</label>
      <select
        id={id}
        value={activeCampaign?.id ?? ''}
        onChange={e => {
          if (e.target.value === ADD_NEW_VALUE) onAddNew();
          else setActiveCampaignId(e.target.value);
        }}
        style={{ width: '100%', padding: '0.5rem' }}
      >
        {!activeCampaign && <option value="" disabled>Select a campaign</option>}
        {campaigns.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
        <option value={ADD_NEW_VALUE}>Add new campaign...</option>
      </select>
    </div>
  );
}
