import { useLocalSearchParams } from 'expo-router';
import { PresetEditor } from '@/components/timetable/preset-editor';

export default function PresetEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PresetEditor key={id} presetId={id} />;
}
