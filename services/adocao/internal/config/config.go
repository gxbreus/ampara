// Package config lê a configuração do serviço só de variáveis de ambiente.
package config

import (
	"errors"
	"os"
)

type Config struct {
	Porta        string
	DatabaseURL  string
	AMQPURL      string
	JWTPublicKey string
}

// Carregar lê a configuração. Os prazos e o teto de reenvios da SAGA são do Orquestrador
// (ORQUESTRADOR_*), não da Adoção.
func Carregar() (Config, error) {
	c := Config{
		Porta:       valorOuPadrao("ADOCAO_PORTA", "8080"),
		DatabaseURL: os.Getenv("ADOCAO_DATABASE_URL"),
		AMQPURL:     os.Getenv("ADOCAO_AMQP_URL"),
		// a Adoção só valida tokens; quem assina é a Identidade, com a chave privada
		JWTPublicKey: os.Getenv("JWT_PUBLIC_KEY"),
	}
	if c.DatabaseURL == "" {
		return c, errors.New("ADOCAO_DATABASE_URL não definida")
	}
	if c.AMQPURL == "" {
		return c, errors.New("ADOCAO_AMQP_URL não definida")
	}
	if c.JWTPublicKey == "" {
		return c, errors.New("JWT_PUBLIC_KEY não definida")
	}
	return c, nil
}

func valorOuPadrao(chave, padrao string) string {
	if v := os.Getenv(chave); v != "" {
		return v
	}
	return padrao
}
