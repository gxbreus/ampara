import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { router } from "expo-router";
import { useSessao } from "./sessao";

export const cores = {
  fundo: "#F8F6F1",
  texto: "#183D36",
  primaria: "#276B53",
  suave: "#E7EEE4",
  erro: "#A33232",
};
export const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  conteudo: { padding: 20, gap: 16 },
  titulo: { fontSize: 28, fontWeight: "700", color: cores.texto },
  texto: { fontSize: 16, lineHeight: 24, color: cores.texto },
  card: {
    backgroundColor: "white",
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
    gap: 8,
  },
  imagem: { width: "100%", height: 220, borderRadius: 14 },
  fila: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  campo: {
    borderWidth: 1,
    borderColor: "#BAC7BC",
    padding: 13,
    borderRadius: 12,
    fontSize: 16,
    color: cores.texto,
    backgroundColor: "white",
  },
});
export function Tela({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <ScrollView
      style={estilos.tela}
      contentContainerStyle={estilos.conteudo}
      keyboardShouldPersistTaps="handled"
    >
      <Text accessibilityRole="header" style={estilos.titulo}>
        {titulo}
      </Text>
      {children}
    </ScrollView>
  );
}
export function Botao({
  children,
  onPress,
  disabled = false,
}: {
  children: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: cores.primaria,
        opacity: disabled ? 0.5 : 1,
        padding: 14,
        borderRadius: 12,
        marginVertical: 4,
      }}
    >
      <Text
        style={{
          color: "white",
          fontWeight: "600",
          textAlign: "center",
          fontSize: 16,
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
}
export function Campo({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={estilos.texto}>{label}</Text>
      <TextInput accessibilityLabel={label} style={estilos.campo} {...props} />
    </View>
  );
}
export function Erro({ error }: { error: Error | null }) {
  return error ? (
    <Text accessibilityRole="alert" style={{ color: cores.erro }}>
      {error.message}
    </Text>
  ) : null;
}
export function Carregando() {
  return (
    <ActivityIndicator accessibilityLabel="Carregando" color={cores.primaria} />
  );
}
export function Protegido({ children }: { children: React.ReactNode }) {
  const { token, pronto } = useSessao();
  if (!pronto) return <Carregando />;
  if (!token)
    return (
      <Tela titulo="Entre para continuar">
        <Text style={estilos.texto}>
          Encontre seu novo companheiro e acompanhe cada etapa da adoção.
        </Text>
        <Botao onPress={() => router.push("/entrar")}>
          Entrar ou criar conta
        </Botao>
      </Tela>
    );
  return <>{children}</>;
}
