import { useCampaigns } from '../context/CampaignContext';
import { DisclosureSelect } from './DisclosureSelect';

const ADD_NEW_VALUE = '__add_new_campaign__';

interface CampaignPickerProps {
  id: string;
  onAddNew: () => void;
}

/** Accessible select to switch campaigns; its last option opens the New Campaign dialog only when chosen. */
export function CampaignPicker({ id, onAddNew }: CampaignPickerProps) {
  const { campaigns, activeCampaign, setActiveCampaignId } = useCampaigns();

  const options = [
    ...campaigns.map(c => ({ value: c.id, label: c.name })),
    { value: ADD_NEW_VALUE, label: 'Add new campaign...' },
  ];

  return (
    <DisclosureSelect
      id={id}
      label="Campaign"
      value={activeCampaign?.id ?? ''}
      options={options}
      onChange={value => {
        if (value === ADD_NEW_VALUE) onAddNew();
        else setActiveCampaignId(value);
      }}
    />
  );
}
