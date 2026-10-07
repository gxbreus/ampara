// Package config lê a configuração do serviço só de variáveis de ambiente.
package config

import (
	"errors"
	"os"
)

type Config struct {
	Porta       string
	DatabaseURL string
}

func Carregar() (Config, error) {
	c := Config{
		Porta:       valorOuPadrao("ADOCAO_PORTA", "8080"),
		DatabaseURL: os.Getenv("ADOCAO_DATABASE_URL"),
	}
	if c.DatabaseURL == "" {
		return c, errors.New("ADOCAO_DATABASE_URL não definida")
	}
	return c, nil
}

func valorOuPadrao(chave, padrao string) string {
	if v := os.Getenv(chave); v != "" {
		return v
	}
	return padrao
}
