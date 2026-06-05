import { CartSheet } from '@/components/equipment/CartSheet';
import EquipmentSearchWidget from '@/components/equipment/EquipmentSearchWidget';

export default function EquipmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
      <div>
        {children}
        <CartSheet />
        <EquipmentSearchWidget />
      </div>
  );
}
