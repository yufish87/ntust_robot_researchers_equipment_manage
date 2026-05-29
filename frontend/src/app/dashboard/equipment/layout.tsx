import { CartSheet } from '@/components/equipment/CartSheet';

export default function EquipmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
      <div>
        {children}
        <CartSheet />
      </div>
  );
}
